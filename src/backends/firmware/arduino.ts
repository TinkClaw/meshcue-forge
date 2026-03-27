/**
 * Arduino Firmware Backend
 *
 * Converts MHDL board + firmware spec → compilable Arduino sketch
 * with proper pin definitions, library includes, and setup/loop.
 */

import type { MHDLDocument, BuildArtifact, Component, Pin } from "../../schema/mhdl.js";

// ─── Code Generation Helpers ─────────────────────────────────

function pinDefine(comp: Component, pin: Pin): string {
  const name = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  return `#define ${name} ${pin.gpio}`;
}

function libraryInclude(lib: string): string {
  return `#include <${lib}>`;
}

// ─── Component-specific code generators ──────────────────────

interface CodeBlock {
  includes: string[];
  globals: string[];
  setup: string[];
  loop: string[];
  functions: string[];
}

function generateLEDCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const color = comp.properties?.["color"] || "unknown";

  return {
    includes: [],
    globals: [],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (${color} LED)`,
    ],
    loop: [],
    functions: [
      `void set_${comp.id}(bool on) {\n  digitalWrite(${pinName}, on ? HIGH : LOW);\n}`,
    ],
  };
}

function generateButtonCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [
      `bool ${comp.id}_pressed = false;`,
      `bool ${comp.id}_last = false;`,
      `unsigned long ${comp.id}_debounce = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT_PULLUP); // ${comp.id}`,
    ],
    loop: [
      `  // ${comp.id} debounce`,
      `  bool ${comp.id}_read = !digitalRead(${pinName});`,
      `  if (${comp.id}_read != ${comp.id}_last) ${comp.id}_debounce = millis();`,
      `  if (millis() - ${comp.id}_debounce > 50) ${comp.id}_pressed = ${comp.id}_read;`,
      `  ${comp.id}_last = ${comp.id}_read;`,
    ],
    functions: [],
  };
}

function generateOLEDCode(comp: Component): CodeBlock {
  const sdaPin = comp.pins.find((p) => p.mode === "i2c-sda");
  const sclPin = comp.pins.find((p) => p.mode === "i2c-scl");
  const addr = comp.properties?.["i2cAddress"] || "0x3C";
  const width = comp.properties?.["width"] || 128;
  const height = comp.properties?.["height"] || 64;

  return {
    includes: [
      "Wire.h",
      "Adafruit_GFX.h",
      "Adafruit_SSD1306.h",
    ],
    globals: [
      `#define SCREEN_WIDTH ${width}`,
      `#define SCREEN_HEIGHT ${height}`,
      `Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);`,
    ],
    setup: [
      ...(sdaPin?.gpio !== undefined && sclPin?.gpio !== undefined
        ? [`  Wire.begin(${sdaPin.gpio}, ${sclPin.gpio});`]
        : [`  Wire.begin();`]),
      `  if (!display.begin(SSD1306_SWITCHCAPVCC, ${addr})) {`,
      `    Serial.println(F("SSD1306 allocation failed"));`,
      `    for (;;);`,
      `  }`,
      `  display.clearDisplay();`,
      `  display.setTextSize(1);`,
      `  display.setTextColor(SSD1306_WHITE);`,
      `  display.setCursor(0, 0);`,
      `  display.println(F("${comp.properties?.["startupText"] || "MeshCue Forge"}"));`,
      `  display.display();`,
    ],
    loop: [],
    functions: [
      `void display_text(const char* line1, const char* line2) {`,
      `  display.clearDisplay();`,
      `  display.setCursor(0, 0);`,
      `  display.setTextSize(1);`,
      `  display.println(line1);`,
      `  display.setCursor(0, 16);`,
      `  display.println(line2);`,
      `  display.display();`,
      `}`,
    ],
  };
}

function generateBuzzerCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm" || p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (buzzer)`,
    ],
    loop: [],
    functions: [
      `void beep(unsigned int frequency, unsigned long duration) {`,
      `  tone(${pinName}, frequency, duration);`,
      `}`,
      ``,
      `void beep_success() { beep(1000, 100); delay(50); beep(1500, 100); }`,
      `void beep_error() { beep(400, 300); }`,
      `void beep_alert() { beep(2000, 50); delay(50); beep(2000, 50); delay(50); beep(2000, 50); }`,
    ],
  };
}

function generateSensorCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in" || p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const model = (comp.model || "dht22").toLowerCase();

  if (model.includes("dht")) {
    return {
      includes: ["DHT.h"],
      globals: [
        `DHT ${comp.id}_sensor(${pinName}, DHT22);`,
        `float ${comp.id}_temp = 0;`,
        `float ${comp.id}_hum = 0;`,
      ],
      setup: [
        `  ${comp.id}_sensor.begin(); // ${comp.id}`,
      ],
      loop: [
        `  ${comp.id}_temp = ${comp.id}_sensor.readTemperature();`,
        `  ${comp.id}_hum = ${comp.id}_sensor.readHumidity();`,
      ],
      functions: [],
    };
  }

  return {
    includes: [],
    globals: [`int ${comp.id}_value = 0;`],
    setup: [`  pinMode(${pinName}, INPUT); // ${comp.id}`],
    loop: [`  ${comp.id}_value = analogRead(${pinName});`],
    functions: [],
  };
}

// ─── Servo ───────────────────────────────────────────────────

function generateServoCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const minAngle = comp.properties?.["minAngle"] ?? 0;
  const maxAngle = comp.properties?.["maxAngle"] ?? 180;

  return {
    includes: ["Servo.h"],
    globals: [
      `Servo ${comp.id}_servo;`,
      `int ${comp.id}_angle = 0;`,
    ],
    setup: [
      `  ${comp.id}_servo.attach(${pinName}); // ${comp.id}`,
      `  ${comp.id}_servo.write(${minAngle});`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_setAngle(int angle) {`,
      `  angle = constrain(angle, ${minAngle}, ${maxAngle});`,
      `  ${comp.id}_servo.write(angle);`,
      `  ${comp.id}_angle = angle;`,
      `}`,
      ``,
      `void ${comp.id}_sweep() {`,
      `  for (int a = ${minAngle}; a <= ${maxAngle}; a++) {`,
      `    ${comp.id}_servo.write(a);`,
      `    delay(15);`,
      `  }`,
      `  for (int a = ${maxAngle}; a >= ${minAngle}; a--) {`,
      `    ${comp.id}_servo.write(a);`,
      `    delay(15);`,
      `  }`,
      `}`,
    ],
  };
}

// ─── NeoPixel / WS2812 ─────────────────────────────────────

function generateNeoPixelCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const numLeds = comp.properties?.["numLeds"] ?? 8;
  const brightness = comp.properties?.["brightness"] ?? 50;

  return {
    includes: ["Adafruit_NeoPixel.h"],
    globals: [
      `#define ${comp.id.toUpperCase()}_NUM_LEDS ${numLeds}`,
      `Adafruit_NeoPixel ${comp.id}_strip(${comp.id.toUpperCase()}_NUM_LEDS, ${pinName}, NEO_GRB + NEO_KHZ800);`,
    ],
    setup: [
      `  ${comp.id}_strip.begin(); // ${comp.id} (NeoPixel)`,
      `  ${comp.id}_strip.setBrightness(${brightness});`,
      `  ${comp.id}_strip.show();`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_setColor(uint8_t r, uint8_t g, uint8_t b) {`,
      `  for (int i = 0; i < ${comp.id.toUpperCase()}_NUM_LEDS; i++) {`,
      `    ${comp.id}_strip.setPixelColor(i, ${comp.id}_strip.Color(r, g, b));`,
      `  }`,
      `  ${comp.id}_strip.show();`,
      `}`,
      ``,
      `void ${comp.id}_rainbow(int wait) {`,
      `  for (long firstPixelHue = 0; firstPixelHue < 65536; firstPixelHue += 256) {`,
      `    for (int i = 0; i < ${comp.id.toUpperCase()}_NUM_LEDS; i++) {`,
      `      int pixelHue = firstPixelHue + (i * 65536L / ${comp.id.toUpperCase()}_NUM_LEDS);`,
      `      ${comp.id}_strip.setPixelColor(i, ${comp.id}_strip.gamma32(${comp.id}_strip.ColorHSV(pixelHue)));`,
      `    }`,
      `    ${comp.id}_strip.show();`,
      `    delay(wait);`,
      `  }`,
      `}`,
    ],
  };
}

// ─── Relay ──────────────────────────────────────────────────

function generateRelayCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const activeLow = comp.properties?.["activeLow"] === true;

  return {
    includes: [],
    globals: [
      `bool ${comp.id}_state = false;`,
    ],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (relay)`,
      `  digitalWrite(${pinName}, ${activeLow ? "HIGH" : "LOW"}); // Start OFF`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_set(bool on) {`,
      `  ${comp.id}_state = on;`,
      `  digitalWrite(${pinName}, ${activeLow ? "on ? LOW : HIGH" : "on ? HIGH : LOW"});`,
      `  delay(50); // Safety delay for relay switching`,
      `}`,
    ],
  };
}

// ─── Motor (H-Bridge) ──────────────────────────────────────

function generateMotorCode(comp: Component): CodeBlock {
  const pwmPin = comp.pins.find((p) => p.mode === "pwm");
  const in1Pin = comp.pins.find((p) => p.id === "in1" || p.id === "dir1");
  const in2Pin = comp.pins.find((p) => p.id === "in2" || p.id === "dir2");
  if (!pwmPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pwmName = `PIN_${comp.id.toUpperCase()}_${pwmPin.id.toUpperCase()}`;
  const in1Name = in1Pin ? `PIN_${comp.id.toUpperCase()}_${in1Pin.id.toUpperCase()}` : undefined;
  const in2Name = in2Pin ? `PIN_${comp.id.toUpperCase()}_${in2Pin.id.toUpperCase()}` : undefined;

  const setupLines = [
    `  pinMode(${pwmName}, OUTPUT); // ${comp.id} (motor PWM)`,
  ];
  if (in1Name) setupLines.push(`  pinMode(${in1Name}, OUTPUT);`);
  if (in2Name) setupLines.push(`  pinMode(${in2Name}, OUTPUT);`);

  const fnLines = [
    `void ${comp.id}_setSpeed(int speed) {`,
    `  // speed: -255 to 255`,
    `  int absSpeed = constrain(abs(speed), 0, 255);`,
  ];
  if (in1Name && in2Name) {
    fnLines.push(
      `  if (speed > 0) {`,
      `    digitalWrite(${in1Name}, HIGH);`,
      `    digitalWrite(${in2Name}, LOW);`,
      `  } else if (speed < 0) {`,
      `    digitalWrite(${in1Name}, LOW);`,
      `    digitalWrite(${in2Name}, HIGH);`,
      `  } else {`,
      `    digitalWrite(${in1Name}, LOW);`,
      `    digitalWrite(${in2Name}, LOW);`,
      `  }`,
    );
  }
  fnLines.push(
    `  analogWrite(${pwmName}, absSpeed);`,
    `}`,
    ``,
    `void ${comp.id}_stop() {`,
  );
  if (in1Name) fnLines.push(`  digitalWrite(${in1Name}, LOW);`);
  if (in2Name) fnLines.push(`  digitalWrite(${in2Name}, LOW);`);
  fnLines.push(
    `  analogWrite(${pwmName}, 0);`,
    `}`,
  );

  return {
    includes: [],
    globals: [],
    setup: setupLines,
    loop: [],
    functions: fnLines,
  };
}

// ─── GPS ────────────────────────────────────────────────────

function generateGPSCode(comp: Component): CodeBlock {
  const txPin = comp.pins.find((p) => p.mode === "uart-tx");
  const rxPin = comp.pins.find((p) => p.mode === "uart-rx");

  const txGpio = txPin?.gpio ?? 16;
  const rxGpio = rxPin?.gpio ?? 17;
  const baud = comp.properties?.["baud"] ?? 9600;

  return {
    includes: ["TinyGPSPlus.h", "SoftwareSerial.h"],
    globals: [
      `TinyGPSPlus ${comp.id}_gps;`,
      `SoftwareSerial ${comp.id}_serial(${rxGpio}, ${txGpio});`,
      `double ${comp.id}_lat = 0.0;`,
      `double ${comp.id}_lon = 0.0;`,
      `double ${comp.id}_speed = 0.0;`,
      `unsigned long ${comp.id}_lastFix = 0;`,
    ],
    setup: [
      `  ${comp.id}_serial.begin(${baud}); // ${comp.id} (GPS)`,
    ],
    loop: [
      `  // ${comp.id} GPS parsing`,
      `  while (${comp.id}_serial.available() > 0) {`,
      `    if (${comp.id}_gps.encode(${comp.id}_serial.read())) {`,
      `      if (${comp.id}_gps.location.isUpdated()) {`,
      `        ${comp.id}_lat = ${comp.id}_gps.location.lat();`,
      `        ${comp.id}_lon = ${comp.id}_gps.location.lng();`,
      `        ${comp.id}_speed = ${comp.id}_gps.speed.kmph();`,
      `        ${comp.id}_lastFix = millis();`,
      `      }`,
      `    }`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── RFID (MFRC522) ────────────────────────────────────────

function generateRFIDCode(comp: Component): CodeBlock {
  const ssPin = comp.pins.find((p) => p.mode === "spi-cs");
  const rstPin = comp.pins.find((p) => p.id === "rst" || p.id === "reset");

  const ssName = ssPin ? `PIN_${comp.id.toUpperCase()}_${ssPin.id.toUpperCase()}` : "SS_PIN";
  const rstName = rstPin ? `PIN_${comp.id.toUpperCase()}_${rstPin.id.toUpperCase()}` : "RST_PIN";

  return {
    includes: ["SPI.h", "MFRC522.h"],
    globals: [
      `MFRC522 ${comp.id}_rfid(${ssName}, ${rstName});`,
      `String ${comp.id}_uid = "";`,
    ],
    setup: [
      `  SPI.begin(); // ${comp.id} (RFID)`,
      `  ${comp.id}_rfid.PCD_Init();`,
      `  Serial.println(F("RFID reader ready"));`,
    ],
    loop: [
      `  // ${comp.id} RFID check`,
      `  if (${comp.id}_rfid.PICC_IsNewCardPresent() && ${comp.id}_rfid.PICC_ReadCardSerial()) {`,
      `    ${comp.id}_uid = "";`,
      `    for (byte i = 0; i < ${comp.id}_rfid.uid.size; i++) {`,
      `      if (${comp.id}_rfid.uid.uidByte[i] < 0x10) ${comp.id}_uid += "0";`,
      `      ${comp.id}_uid += String(${comp.id}_rfid.uid.uidByte[i], HEX);`,
      `    }`,
      `    ${comp.id}_uid.toUpperCase();`,
      `    Serial.print(F("RFID UID: ")); Serial.println(${comp.id}_uid);`,
      `    ${comp.id}_rfid.PICC_HaltA();`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── PIR Motion Sensor ──────────────────────────────────────

function generatePIRCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const debounceMs = comp.properties?.["debounceMs"] ?? 2000;

  return {
    includes: [],
    globals: [
      `bool ${comp.id}_motion = false;`,
      `unsigned long ${comp.id}_lastTrigger = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (PIR)`,
      `  delay(2000); // PIR warm-up`,
    ],
    loop: [
      `  // ${comp.id} motion detection with debounce`,
      `  if (digitalRead(${pinName}) == HIGH && (millis() - ${comp.id}_lastTrigger > ${debounceMs})) {`,
      `    ${comp.id}_motion = true;`,
      `    ${comp.id}_lastTrigger = millis();`,
      `    Serial.println(F("Motion detected!"));`,
      `  } else if (millis() - ${comp.id}_lastTrigger > ${debounceMs}) {`,
      `    ${comp.id}_motion = false;`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── Speaker ────────────────────────────────────────────────

function generateSpeakerCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm" || p.mode === "digital-out");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [],
    setup: [
      `  pinMode(${pinName}, OUTPUT); // ${comp.id} (speaker)`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_playTone(unsigned int frequency, unsigned long duration) {`,
      `  tone(${pinName}, frequency, duration);`,
      `}`,
      ``,
      `void ${comp.id}_playMelody(const unsigned int* notes, const unsigned int* durations, int length) {`,
      `  for (int i = 0; i < length; i++) {`,
      `    if (notes[i] == 0) {`,
      `      noTone(${pinName});`,
      `    } else {`,
      `      tone(${pinName}, notes[i], durations[i]);`,
      `    }`,
      `    delay(durations[i] * 1.3);`,
      `    noTone(${pinName});`,
      `  }`,
      `}`,
      ``,
      `void ${comp.id}_stop() {`,
      `  noTone(${pinName});`,
      `}`,
    ],
  };
}

// ─── Microphone ─────────────────────────────────────────────

function generateMicrophoneCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const threshold = comp.properties?.["threshold"] ?? 512;
  const sampleWindow = comp.properties?.["sampleWindowMs"] ?? 50;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_value = 0;`,
      `int ${comp.id}_peak = 0;`,
      `bool ${comp.id}_triggered = false;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (microphone)`,
    ],
    loop: [
      `  // ${comp.id} microphone sampling`,
      `  {`,
      `    unsigned long ${comp.id}_start = millis();`,
      `    int ${comp.id}_min = 1024, ${comp.id}_max = 0;`,
      `    while (millis() - ${comp.id}_start < ${sampleWindow}) {`,
      `      int sample = analogRead(${pinName});`,
      `      if (sample > ${comp.id}_max) ${comp.id}_max = sample;`,
      `      if (sample < ${comp.id}_min) ${comp.id}_min = sample;`,
      `    }`,
      `    ${comp.id}_peak = ${comp.id}_max - ${comp.id}_min;`,
      `    ${comp.id}_value = (${comp.id}_max + ${comp.id}_min) / 2;`,
      `    ${comp.id}_triggered = ${comp.id}_peak > ${threshold};`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── IR Receiver ────────────────────────────────────────────

function generateIRReceiverCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: ["IRremote.h"],
    globals: [
      `unsigned long ${comp.id}_code = 0;`,
      `bool ${comp.id}_received = false;`,
    ],
    setup: [
      `  IrReceiver.begin(${pinName}, ENABLE_LED_FEEDBACK); // ${comp.id} (IR receiver)`,
    ],
    loop: [
      `  // ${comp.id} IR receive`,
      `  if (IrReceiver.decode()) {`,
      `    ${comp.id}_code = IrReceiver.decodedIRData.decodedRawData;`,
      `    ${comp.id}_received = true;`,
      `    Serial.print(F("IR code: 0x")); Serial.println(${comp.id}_code, HEX);`,
      `    IrReceiver.resume();`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── IR Emitter ─────────────────────────────────────────────

function generateIREmitterCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out" || p.mode === "pwm");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: ["IRremote.h"],
    globals: [],
    setup: [
      `  IrSender.begin(${pinName}); // ${comp.id} (IR emitter)`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_sendNEC(uint16_t address, uint8_t command) {`,
      `  IrSender.sendNEC(address, command, 0);`,
      `}`,
      ``,
      `void ${comp.id}_sendRaw(unsigned long code, int bits) {`,
      `  IrSender.sendNECRaw(code, 0);`,
      `}`,
    ],
  };
}

// ─── Potentiometer ──────────────────────────────────────────

function generatePotentiometerCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const mapMin = comp.properties?.["mapMin"] ?? 0;
  const mapMax = comp.properties?.["mapMax"] ?? 100;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_raw = 0;`,
      `int ${comp.id}_mapped = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (potentiometer)`,
    ],
    loop: [
      `  ${comp.id}_raw = analogRead(${pinName});`,
      `  ${comp.id}_mapped = map(${comp.id}_raw, 0, 1023, ${mapMin}, ${mapMax});`,
    ],
    functions: [],
  };
}

// ─── LDR / Light Sensor ────────────────────────────────────

function generateLDRCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const threshold = comp.properties?.["threshold"] ?? 500;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_value = 0;`,
      `bool ${comp.id}_dark = false;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (LDR)`,
    ],
    loop: [
      `  ${comp.id}_value = analogRead(${pinName});`,
      `  ${comp.id}_dark = (${comp.id}_value < ${threshold});`,
    ],
    functions: [],
  };
}

// ─── Ultrasonic (HC-SR04) ──────────────────────────────────

function generateUltrasonicCode(comp: Component): CodeBlock {
  const trigPin = comp.pins.find((p) => p.id === "trig" || p.id === "trigger");
  const echoPin = comp.pins.find((p) => p.id === "echo");
  if (!trigPin || !echoPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const trigName = `PIN_${comp.id.toUpperCase()}_${trigPin.id.toUpperCase()}`;
  const echoName = `PIN_${comp.id.toUpperCase()}_${echoPin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [
      `float ${comp.id}_distanceCm = 0;`,
    ],
    setup: [
      `  pinMode(${trigName}, OUTPUT); // ${comp.id} (ultrasonic trig)`,
      `  pinMode(${echoName}, INPUT);  // ${comp.id} (ultrasonic echo)`,
    ],
    loop: [
      `  // ${comp.id} distance measurement`,
      `  digitalWrite(${trigName}, LOW);`,
      `  delayMicroseconds(2);`,
      `  digitalWrite(${trigName}, HIGH);`,
      `  delayMicroseconds(10);`,
      `  digitalWrite(${trigName}, LOW);`,
      `  ${comp.id}_distanceCm = pulseIn(${echoName}, HIGH, 30000) * 0.034 / 2.0;`,
    ],
    functions: [],
  };
}

// ─── Moisture Sensor ────────────────────────────────────────

function generateMoistureCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_raw = 0;`,
      `int ${comp.id}_percent = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (moisture sensor)`,
    ],
    loop: [
      `  ${comp.id}_raw = analogRead(${pinName});`,
      `  ${comp.id}_percent = map(${comp.id}_raw, 1023, 0, 0, 100); // Invert: wet = high %`,
    ],
    functions: [],
  };
}

// ─── Gas Sensor (MQ series) ────────────────────────────────

function generateGasSensorCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const warmUpSec = comp.properties?.["warmUpSeconds"] ?? 20;
  const threshold = comp.properties?.["threshold"] ?? 400;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_value = 0;`,
      `bool ${comp.id}_alert = false;`,
      `bool ${comp.id}_ready = false;`,
      `unsigned long ${comp.id}_startTime = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (gas sensor)`,
      `  ${comp.id}_startTime = millis();`,
      `  Serial.println(F("Gas sensor warming up..."));`,
    ],
    loop: [
      `  // ${comp.id} gas sensor`,
      `  if (!${comp.id}_ready && millis() - ${comp.id}_startTime > ${Number(warmUpSec) * 1000}UL) {`,
      `    ${comp.id}_ready = true;`,
      `    Serial.println(F("Gas sensor ready"));`,
      `  }`,
      `  if (${comp.id}_ready) {`,
      `    ${comp.id}_value = analogRead(${pinName});`,
      `    ${comp.id}_alert = (${comp.id}_value > ${threshold});`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── LCD (I2C) ──────────────────────────────────────────────

function generateLCDCode(comp: Component): CodeBlock {
  const addr = comp.properties?.["i2cAddress"] || "0x27";
  const cols = comp.properties?.["cols"] ?? 16;
  const rows = comp.properties?.["rows"] ?? 2;

  return {
    includes: ["Wire.h", "LiquidCrystal_I2C.h"],
    globals: [
      `LiquidCrystal_I2C ${comp.id}_lcd(${addr}, ${cols}, ${rows});`,
    ],
    setup: [
      `  ${comp.id}_lcd.init(); // ${comp.id} (LCD ${cols}x${rows})`,
      `  ${comp.id}_lcd.backlight();`,
      `  ${comp.id}_lcd.setCursor(0, 0);`,
      `  ${comp.id}_lcd.print(F("${comp.properties?.["startupText"] || "MeshCue Forge"}"));`,
    ],
    loop: [],
    functions: [
      `void ${comp.id}_print(int col, int row, const char* text) {`,
      `  ${comp.id}_lcd.setCursor(col, row);`,
      `  ${comp.id}_lcd.print(text);`,
      `}`,
      ``,
      `void ${comp.id}_clear() {`,
      `  ${comp.id}_lcd.clear();`,
      `}`,
    ],
  };
}

// ─── Stepper Motor (AccelStepper) ──────────────────────────

function generateStepperCode(comp: Component): CodeBlock {
  const step = comp.pins.find((p) => p.id === "step" || p.id === "stp");
  const dir = comp.pins.find((p) => p.id === "dir");
  if (!step || !dir) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const stepName = `PIN_${comp.id.toUpperCase()}_${step.id.toUpperCase()}`;
  const dirName = `PIN_${comp.id.toUpperCase()}_${dir.id.toUpperCase()}`;
  const maxSpeed = comp.properties?.["maxSpeed"] ?? 1000;
  const acceleration = comp.properties?.["acceleration"] ?? 500;

  return {
    includes: ["AccelStepper.h"],
    globals: [
      `AccelStepper ${comp.id}_stepper(AccelStepper::DRIVER, ${stepName}, ${dirName});`,
    ],
    setup: [
      `  ${comp.id}_stepper.setMaxSpeed(${maxSpeed}); // ${comp.id} (stepper)`,
      `  ${comp.id}_stepper.setAcceleration(${acceleration});`,
    ],
    loop: [
      `  ${comp.id}_stepper.run();`,
    ],
    functions: [
      `void ${comp.id}_moveTo(long position) {`,
      `  ${comp.id}_stepper.moveTo(position);`,
      `}`,
      ``,
      `void ${comp.id}_setSpeed(float speed) {`,
      `  ${comp.id}_stepper.setSpeed(speed);`,
      `}`,
    ],
  };
}

// ─── Rotary Encoder ─────────────────────────────────────────

function generateEncoderCode(comp: Component): CodeBlock {
  const clkPin = comp.pins.find((p) => p.id === "clk" || p.id === "a");
  const dtPin = comp.pins.find((p) => p.id === "dt" || p.id === "b");
  const swPin = comp.pins.find((p) => p.id === "sw" || p.id === "button");
  if (!clkPin || !dtPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const clkName = `PIN_${comp.id.toUpperCase()}_${clkPin.id.toUpperCase()}`;
  const dtName = `PIN_${comp.id.toUpperCase()}_${dtPin.id.toUpperCase()}`;

  const globals = [
    `volatile int ${comp.id}_position = 0;`,
    `int ${comp.id}_lastPosition = 0;`,
    `int ${comp.id}_lastClk = HIGH;`,
  ];

  const setupLines = [
    `  pinMode(${clkName}, INPUT_PULLUP); // ${comp.id} (encoder CLK)`,
    `  pinMode(${dtName}, INPUT_PULLUP);  // ${comp.id} (encoder DT)`,
  ];

  if (swPin) {
    const swName = `PIN_${comp.id.toUpperCase()}_${swPin.id.toUpperCase()}`;
    globals.push(`bool ${comp.id}_button = false;`);
    setupLines.push(`  pinMode(${swName}, INPUT_PULLUP); // ${comp.id} (encoder SW)`);
  }

  const loopLines = [
    `  // ${comp.id} encoder read`,
    `  {`,
    `    int clk = digitalRead(${clkName});`,
    `    if (clk != ${comp.id}_lastClk && clk == LOW) {`,
    `      if (digitalRead(${dtName}) != clk) {`,
    `        ${comp.id}_position++;`,
    `      } else {`,
    `        ${comp.id}_position--;`,
    `      }`,
    `    }`,
    `    ${comp.id}_lastClk = clk;`,
  ];

  if (swPin) {
    const swName = `PIN_${comp.id.toUpperCase()}_${swPin.id.toUpperCase()}`;
    loopLines.push(`    ${comp.id}_button = !digitalRead(${swName});`);
  }
  loopLines.push(`  }`);

  return {
    includes: [],
    globals,
    setup: setupLines,
    loop: loopLines,
    functions: [],
  };
}

// ─── Temperature Sensor (DHT / DS18B20) ────────────────────

function generateTemperatureSensorCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in" || p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;
  const model = (comp.model || "dht22").toLowerCase();

  if (model.includes("ds18b20") || model.includes("onewire")) {
    return {
      includes: ["OneWire.h", "DallasTemperature.h"],
      globals: [
        `OneWire ${comp.id}_oneWire(${pinName});`,
        `DallasTemperature ${comp.id}_sensors(&${comp.id}_oneWire);`,
        `float ${comp.id}_tempC = 0;`,
      ],
      setup: [
        `  ${comp.id}_sensors.begin(); // ${comp.id} (DS18B20)`,
      ],
      loop: [
        `  ${comp.id}_sensors.requestTemperatures();`,
        `  ${comp.id}_tempC = ${comp.id}_sensors.getTempCByIndex(0);`,
      ],
      functions: [],
    };
  }

  // DHT11 / DHT22
  const dhtType = model.includes("dht11") ? "DHT11" : "DHT22";
  return {
    includes: ["DHT.h"],
    globals: [
      `DHT ${comp.id}_dht(${pinName}, ${dhtType});`,
      `float ${comp.id}_tempC = 0;`,
      `float ${comp.id}_humidity = 0;`,
    ],
    setup: [
      `  ${comp.id}_dht.begin(); // ${comp.id} (${dhtType})`,
    ],
    loop: [
      `  ${comp.id}_tempC = ${comp.id}_dht.readTemperature();`,
      `  ${comp.id}_humidity = ${comp.id}_dht.readHumidity();`,
    ],
    functions: [],
  };
}

// ─── Thermocouple (MAX6675) ────────────────────────────────

function generateThermocoupleCode(comp: Component): CodeBlock {
  const csPin = comp.pins.find((p) => p.mode === "spi-cs");
  const sckPin = comp.pins.find((p) => p.mode === "spi-sck");
  const soPin = comp.pins.find((p) => p.mode === "spi-miso");
  if (!csPin || !sckPin || !soPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const csName = `PIN_${comp.id.toUpperCase()}_${csPin.id.toUpperCase()}`;
  const sckName = `PIN_${comp.id.toUpperCase()}_${sckPin.id.toUpperCase()}`;
  const soName = `PIN_${comp.id.toUpperCase()}_${soPin.id.toUpperCase()}`;

  return {
    includes: ["max6675.h"],
    globals: [
      `MAX6675 ${comp.id}_tc(${sckName}, ${csName}, ${soName});`,
      `float ${comp.id}_tempC = 0;`,
    ],
    setup: [
      `  delay(500); // ${comp.id} (MAX6675) stabilization`,
    ],
    loop: [
      `  ${comp.id}_tempC = ${comp.id}_tc.readCelsius();`,
    ],
    functions: [],
  };
}

// ─── Joystick ───────────────────────────────────────────────

function generateJoystickCode(comp: Component): CodeBlock {
  const xPin = comp.pins.find((p) => p.id === "x" || p.id === "vrx");
  const yPin = comp.pins.find((p) => p.id === "y" || p.id === "vry");
  const swPin = comp.pins.find((p) => p.id === "sw" || p.id === "button");
  if (!xPin || !yPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const xName = `PIN_${comp.id.toUpperCase()}_${xPin.id.toUpperCase()}`;
  const yName = `PIN_${comp.id.toUpperCase()}_${yPin.id.toUpperCase()}`;

  const globals = [
    `int ${comp.id}_x = 512;`,
    `int ${comp.id}_y = 512;`,
  ];
  const setupLines = [
    `  pinMode(${xName}, INPUT); // ${comp.id} (joystick X)`,
    `  pinMode(${yName}, INPUT); // ${comp.id} (joystick Y)`,
  ];
  const loopLines = [
    `  ${comp.id}_x = analogRead(${xName});`,
    `  ${comp.id}_y = analogRead(${yName});`,
  ];

  if (swPin) {
    const swName = `PIN_${comp.id.toUpperCase()}_${swPin.id.toUpperCase()}`;
    globals.push(`bool ${comp.id}_button = false;`);
    setupLines.push(`  pinMode(${swName}, INPUT_PULLUP); // ${comp.id} (joystick button)`);
    loopLines.push(`  ${comp.id}_button = !digitalRead(${swName});`);
  }

  return {
    includes: [],
    globals,
    setup: setupLines,
    loop: loopLines,
    functions: [],
  };
}

// ─── Medical: Pulse Oximeter (MAX30102) ─────────────────────

function generatePulseOximeterCode(comp: Component): CodeBlock {
  const sdaPin = comp.pins.find((p) => p.mode === "i2c-sda");
  const sclPin = comp.pins.find((p) => p.mode === "i2c-scl");

  return {
    includes: ["Wire.h", "MAX30105.h", "heartRate.h"],
    globals: [
      `MAX30105 ${comp.id}_sensor;`,
      `float ${comp.id}_spo2 = 0;`,
      `float ${comp.id}_heartRate = 0;`,
      `uint32_t ${comp.id}_irBuffer[100];`,
      `uint32_t ${comp.id}_redBuffer[100];`,
      `int ${comp.id}_bufferLength = 100;`,
    ],
    setup: [
      ...(sdaPin?.gpio !== undefined && sclPin?.gpio !== undefined
        ? [`  Wire.begin(${sdaPin.gpio}, ${sclPin.gpio});`]
        : []),
      `  if (!${comp.id}_sensor.begin(Wire, I2C_SPEED_FAST)) {`,
      `    Serial.println(F("MAX30102 not found"));`,
      `    while (1);`,
      `  }`,
      `  ${comp.id}_sensor.setup(60, 4, 2, 100, 411, 4096); // ${comp.id} (pulse oximeter)`,
    ],
    loop: [
      `  // ${comp.id} pulse oximeter reading`,
      `  for (int i = 0; i < ${comp.id}_bufferLength; i++) {`,
      `    while (!${comp.id}_sensor.available()) ${comp.id}_sensor.check();`,
      `    ${comp.id}_redBuffer[i] = ${comp.id}_sensor.getRed();`,
      `    ${comp.id}_irBuffer[i] = ${comp.id}_sensor.getIR();`,
      `    ${comp.id}_sensor.nextSample();`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── Medical: ECG (AD8232) ──────────────────────────────────

function generateECGCode(comp: Component): CodeBlock {
  const outPin = comp.pins.find((p) => p.mode === "analog-in");
  const loPlusPin = comp.pins.find((p) => p.id === "lo_plus" || p.id === "lo+");
  const loMinusPin = comp.pins.find((p) => p.id === "lo_minus" || p.id === "lo-");
  if (!outPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const outName = `PIN_${comp.id.toUpperCase()}_${outPin.id.toUpperCase()}`;
  const loPlusName = loPlusPin ? `PIN_${comp.id.toUpperCase()}_${loPlusPin.id.toUpperCase()}` : undefined;
  const loMinusName = loMinusPin ? `PIN_${comp.id.toUpperCase()}_${loMinusPin.id.toUpperCase()}` : undefined;

  const setupLines = [
    `  pinMode(${outName}, INPUT); // ${comp.id} (ECG output)`,
  ];
  if (loPlusName) setupLines.push(`  pinMode(${loPlusName}, INPUT); // leads-off detection +`);
  if (loMinusName) setupLines.push(`  pinMode(${loMinusName}, INPUT); // leads-off detection -`);

  const loopLines = [
    `  // ${comp.id} ECG reading`,
  ];
  if (loPlusName && loMinusName) {
    loopLines.push(
      `  if (digitalRead(${loPlusName}) == 1 || digitalRead(${loMinusName}) == 1) {`,
      `    ${comp.id}_leadsOff = true;`,
      `  } else {`,
      `    ${comp.id}_leadsOff = false;`,
      `    ${comp.id}_value = analogRead(${outName});`,
      `  }`,
    );
  } else {
    loopLines.push(`  ${comp.id}_value = analogRead(${outName});`);
  }

  return {
    includes: [],
    globals: [
      `int ${comp.id}_value = 0;`,
      `bool ${comp.id}_leadsOff = false;`,
    ],
    setup: setupLines,
    loop: loopLines,
    functions: [],
  };
}

// ─── Medical: Blood Pressure ────────────────────────────────

function generateBloodPressureCode(comp: Component): CodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const pinName = `PIN_${comp.id.toUpperCase()}_${pin.id.toUpperCase()}`;

  return {
    includes: [],
    globals: [
      `int ${comp.id}_rawPressure = 0;`,
      `float ${comp.id}_mmHg = 0;`,
      `float ${comp.id}_systolic = 0;`,
      `float ${comp.id}_diastolic = 0;`,
    ],
    setup: [
      `  pinMode(${pinName}, INPUT); // ${comp.id} (pressure transducer)`,
    ],
    loop: [
      `  // ${comp.id} pressure reading`,
      `  ${comp.id}_rawPressure = analogRead(${pinName});`,
      `  ${comp.id}_mmHg = (${comp.id}_rawPressure / 1023.0) * 300.0; // 0-300 mmHg range`,
    ],
    functions: [],
  };
}

// ─── Medical: Load Cell (Weight/Scale) ──────────────────────

function generateLoadCellCode(comp: Component): CodeBlock {
  const doutPin = comp.pins.find((p) => p.id === "dout" || p.id === "data");
  const sckPin = comp.pins.find((p) => p.id === "sck" || p.id === "clk");
  if (!doutPin || !sckPin) return { includes: [], globals: [], setup: [], loop: [], functions: [] };

  const doutName = `PIN_${comp.id.toUpperCase()}_${doutPin.id.toUpperCase()}`;
  const sckName = `PIN_${comp.id.toUpperCase()}_${sckPin.id.toUpperCase()}`;

  return {
    includes: ["HX711.h"],
    globals: [
      `HX711 ${comp.id}_scale;`,
      `float ${comp.id}_weight = 0;`,
      `float ${comp.id}_rawValue = 0;`,
    ],
    setup: [
      `  ${comp.id}_scale.begin(${doutName}, ${sckName}); // ${comp.id} (load cell)`,
      `  ${comp.id}_scale.set_scale();`,
      `  ${comp.id}_scale.tare();`,
    ],
    loop: [
      `  // ${comp.id} weight reading`,
      `  if (${comp.id}_scale.is_ready()) {`,
      `    ${comp.id}_rawValue = ${comp.id}_scale.get_units(5);`,
      `    ${comp.id}_weight = ${comp.id}_rawValue;`,
      `  }`,
    ],
    functions: [],
  };
}

// ─── Medical: Color Sensor (TCS34725) ───────────────────────

function generateColorSensorCode(comp: Component): CodeBlock {
  return {
    includes: ["Wire.h", "Adafruit_TCS34725.h"],
    globals: [
      `Adafruit_TCS34725 ${comp.id}_tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_700MS, TCS34725_GAIN_1X);`,
      `uint16_t ${comp.id}_r = 0, ${comp.id}_g = 0, ${comp.id}_b = 0, ${comp.id}_c = 0;`,
      `float ${comp.id}_colorTemp = 0;`,
      `float ${comp.id}_lux = 0;`,
    ],
    setup: [
      `  if (!${comp.id}_tcs.begin()) {`,
      `    Serial.println(F("TCS34725 not found"));`,
      `    while (1);`,
      `  }`,
      `  Serial.println(F("TCS34725 ready")); // ${comp.id} (color sensor)`,
    ],
    loop: [
      `  // ${comp.id} color reading`,
      `  ${comp.id}_tcs.getRawData(&${comp.id}_r, &${comp.id}_g, &${comp.id}_b, &${comp.id}_c);`,
      `  ${comp.id}_colorTemp = ${comp.id}_tcs.calculateColorTemperature_dn40(${comp.id}_r, ${comp.id}_g, ${comp.id}_b, ${comp.id}_c);`,
      `  ${comp.id}_lux = ${comp.id}_tcs.calculateLux(${comp.id}_r, ${comp.id}_g, ${comp.id}_b);`,
    ],
    functions: [],
  };
}

// ─── Medical Calibration Code Generation ────────────────────

/** Set of component types that participate in medical calibration */
const MEDICAL_CALIBRATABLE_TYPES = new Set([
  "pulse_oximeter",
  "ecg",
  "temperature_sensor",
  "blood_pressure",
  "load_cell",
  "color_sensor",
]);

/**
 * Generates the CalibrationManager framework code block.
 * Included when `doc.meta.medical` is true and at least one
 * calibratable component is present.
 */
function generateCalibrationManagerCode(
  calibratableTypes: Set<string>,
): CodeBlock {
  const includes = ["EEPROM.h"];
  const globals: string[] = [
    `// ─── CalibrationManager ─────────────────────────`,
    `#define CALIB_MAGIC 0xCA11B000`,
    ``,
    `struct CalibrationData {`,
    `  uint32_t magic;           // CALIB_MAGIC when valid`,
    `  float spo2Offset;`,
    `  float spo2Gain;`,
    `  float ecgGain;`,
    `  float ecgBaseline;`,
    `  float tempGain;`,
    `  float tempOffset;`,
    `  float pressureZero;`,
    `  float weightTare;`,
    `  float weightScale;`,
    `  float colorR, colorG, colorB;`,
    `  uint32_t calibratedAt;    // millis timestamp`,
    `};`,
    ``,
    `CalibrationData calibData;`,
    `bool calibValid = false;`,
    `bool calibMode = false;`,
    `unsigned long calibBtnStart = 0;`,
    `const unsigned long CALIB_HOLD_MS = 5000; // hold 5s to enter calibration`,
  ];

  const setup: string[] = [
    `  // Load calibration from EEPROM`,
    `  loadCalibration();`,
  ];

  const loop: string[] = [
    `  // Calibration mode entry: hold first button for 5 seconds`,
    `  // (implement button detection per your wiring)`,
    `  if (calibMode) {`,
    `    runCalibrationSequence();`,
    `    calibMode = false;`,
    `  }`,
  ];

  // Build helper functions
  const functions: string[] = [];

  // ── loadCalibration ──
  functions.push(
    `void loadCalibration() {`,
    `  EEPROM.get(0, calibData);`,
    `  if (calibData.magic == CALIB_MAGIC) {`,
    `    calibValid = true;`,
    `    Serial.println(F("Calibration loaded from EEPROM"));`,
    `  } else {`,
    `    calibValid = false;`,
    `    // Set safe defaults`,
    `    calibData.spo2Offset = 0; calibData.spo2Gain = 1.0;`,
    `    calibData.ecgGain = 1.0; calibData.ecgBaseline = 512.0;`,
    `    calibData.tempGain = 1.0; calibData.tempOffset = 0;`,
    `    calibData.pressureZero = 0;`,
    `    calibData.weightTare = 0; calibData.weightScale = 1.0;`,
    `    calibData.colorR = 1.0; calibData.colorG = 1.0; calibData.colorB = 1.0;`,
    `    Serial.println(F("WARNING: UNCALIBRATED — hold button 5s to calibrate"));`,
    `  }`,
    `}`,
    ``,
  );

  // ── saveCalibration ──
  functions.push(
    `void saveCalibration() {`,
    `  calibData.magic = CALIB_MAGIC;`,
    `  calibData.calibratedAt = millis();`,
    `  EEPROM.put(0, calibData);`,
    `#ifdef ESP32`,
    `  EEPROM.commit();`,
    `#endif`,
    `  calibValid = true;`,
    `  Serial.println(F("Calibration saved to EEPROM"));`,
    `}`,
    ``,
  );

  // ── SpO2 calibration ──
  if (calibratableTypes.has("pulse_oximeter")) {
    functions.push(
      `void calibrateSpo2() {`,
      `  display_text("SpO2 CALIBRATION", "Place finger...");`,
      `  Serial.println(F("SpO2 calibration: place finger on sensor"));`,
      `  Serial.println(F("Enter known SpO2 reference value (e.g. 97):"));`,
      `  delay(2000);`,
      ``,
      `  // Collect raw IR/Red for 30 seconds`,
      `  float irSum = 0, redSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  display_text("SpO2 CALIBRATE", "Reading 30s...");`,
      `  while (millis() - calStart < 30000) {`,
      `    // Read raw values from sensor (assumes sensor object exists)`,
      `    // Accumulate IR and Red channel values`,
      `    irSum += 50000; // placeholder — replace with actual sensor read`,
      `    redSum += 45000;`,
      `    samples++;`,
      `    delay(10);`,
      `  }`,
      ``,
      `  float avgRatio = (redSum / samples) / (irSum / samples);`,
      `  // Default SpO2 lookup: SpO2 = 110 - 25 * ratio`,
      `  // Reference calibration: adjust offset so computed matches known value`,
      `  float computedSpo2 = 110.0 - 25.0 * avgRatio;`,
      `  float referenceSpo2 = 97.0; // TODO: read from serial or button input`,
      `  calibData.spo2Offset = referenceSpo2 - computedSpo2;`,
      `  calibData.spo2Gain = 1.0;`,
      ``,
      `  display_text("SpO2 CALIBRATED", "Offset saved");`,
      `  Serial.print(F("SpO2 offset: ")); Serial.println(calibData.spo2Offset);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── ECG calibration ──
  if (calibratableTypes.has("ecg")) {
    functions.push(
      `void calibrateECG() {`,
      `  display_text("ECG CALIBRATION", "Rest 10s...");`,
      `  Serial.println(F("ECG calibration: remain still for baseline"));`,
      `  delay(2000);`,
      ``,
      `  // Record resting baseline for 10 seconds`,
      `  float baselineSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  while (millis() - calStart < 10000) {`,
      `    baselineSum += analogRead(A0); // TODO: use actual ECG pin`,
      `    samples++;`,
      `    delay(2);`,
      `  }`,
      `  calibData.ecgBaseline = baselineSum / samples;`,
      ``,
      `  // Gain calibration: apply known 1mV signal if available`,
      `  // For self-calibration, compute gain from baseline noise floor`,
      `  display_text("ECG: apply 1mV", "signal now...");`,
      `  Serial.println(F("Apply 1mV calibration signal (or press button to skip)"));`,
      `  delay(5000);`,
      ``,
      `  float signalSum = 0;`,
      `  samples = 0;`,
      `  calStart = millis();`,
      `  while (millis() - calStart < 5000) {`,
      `    signalSum += analogRead(A0);`,
      `    samples++;`,
      `    delay(2);`,
      `  }`,
      `  float signalAvg = signalSum / samples;`,
      `  float deltaADC = abs(signalAvg - calibData.ecgBaseline);`,
      `  if (deltaADC > 10) {`,
      `    // 1mV should produce known ADC delta; gain = expected / measured`,
      `    calibData.ecgGain = 1.0 / (deltaADC / 512.0); // normalized`,
      `  } else {`,
      `    calibData.ecgGain = 1.0; // no calibration signal detected`,
      `  }`,
      ``,
      `  display_text("ECG CALIBRATED", "Saved");`,
      `  Serial.print(F("ECG baseline: ")); Serial.println(calibData.ecgBaseline);`,
      `  Serial.print(F("ECG gain: ")); Serial.println(calibData.ecgGain);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── Temperature calibration ──
  if (calibratableTypes.has("temperature_sensor")) {
    functions.push(
      `void calibrateTemp() {`,
      `  display_text("TEMP CALIBRATE", "Ice-point (0C)");`,
      `  Serial.println(F("Temperature calibration: place sensor in ice-water bath (0C)"));`,
      `  Serial.println(F("Press button when ready..."));`,
      `  delay(10000); // wait for user`,
      ``,
      `  // Read ice-point reference`,
      `  float iceSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  while (millis() - calStart < 10000) {`,
      `    iceSum += analogRead(A0); // TODO: use actual temp sensor read`,
      `    samples++;`,
      `    delay(100);`,
      `  }`,
      `  float iceRaw = iceSum / samples;`,
      ``,
      `  display_text("TEMP CALIBRATE", "Body temp ref");`,
      `  Serial.println(F("Now place sensor at known body temperature (e.g. 37C)"));`,
      `  delay(10000);`,
      ``,
      `  float bodySum = 0;`,
      `  samples = 0;`,
      `  calStart = millis();`,
      `  while (millis() - calStart < 10000) {`,
      `    bodySum += analogRead(A0);`,
      `    samples++;`,
      `    delay(100);`,
      `  }`,
      `  float bodyRaw = bodySum / samples;`,
      ``,
      `  // Two-point linear correction: corrected = raw * gain + offset`,
      `  // Point 1: raw=iceRaw, actual=0; Point 2: raw=bodyRaw, actual=37`,
      `  if (abs(bodyRaw - iceRaw) > 0.001) {`,
      `    calibData.tempGain = 37.0 / (bodyRaw - iceRaw);`,
      `    calibData.tempOffset = -iceRaw * calibData.tempGain;`,
      `  } else {`,
      `    calibData.tempGain = 1.0;`,
      `    calibData.tempOffset = 0;`,
      `  }`,
      ``,
      `  display_text("TEMP CALIBRATED", "Saved");`,
      `  Serial.print(F("Temp gain: ")); Serial.println(calibData.tempGain, 6);`,
      `  Serial.print(F("Temp offset: ")); Serial.println(calibData.tempOffset, 4);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── Blood pressure calibration ──
  if (calibratableTypes.has("blood_pressure")) {
    functions.push(
      `void calibratePressure() {`,
      `  display_text("BP CALIBRATE", "Open to air");`,
      `  Serial.println(F("Blood pressure calibration: ensure cuff is deflated / sensor open to air"));`,
      `  delay(5000);`,
      ``,
      `  // Zero-point calibration at atmospheric pressure`,
      `  float zeroSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  while (millis() - calStart < 5000) {`,
      `    zeroSum += analogRead(A0); // TODO: use actual pressure pin`,
      `    samples++;`,
      `    delay(10);`,
      `  }`,
      `  calibData.pressureZero = zeroSum / samples;`,
      ``,
      `  display_text("BP: ref check", "Use sphygmo...");`,
      `  Serial.println(F("Optional: inflate to known pressure from mercury sphygmomanometer"));`,
      `  Serial.println(F("Skipping in 10s if no input..."));`,
      `  delay(10000);`,
      ``,
      `  display_text("BP CALIBRATED", "Zero saved");`,
      `  Serial.print(F("Pressure zero: ")); Serial.println(calibData.pressureZero);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── Load cell calibration ──
  if (calibratableTypes.has("load_cell")) {
    functions.push(
      `void calibrateWeight() {`,
      `  display_text("WEIGHT CALIBRATE", "Remove all load");`,
      `  Serial.println(F("Weight calibration: remove all weight from scale"));`,
      `  delay(5000);`,
      ``,
      `  // Tare — zero with no load`,
      `  float tareSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  while (millis() - calStart < 5000) {`,
      `    tareSum += analogRead(A0); // TODO: use actual HX711 read`,
      `    samples++;`,
      `    delay(10);`,
      `  }`,
      `  calibData.weightTare = tareSum / samples;`,
      ``,
      `  // Span calibration with known weight`,
      `  display_text("WEIGHT CALIBRATE", "Place known wt");`,
      `  Serial.println(F("Place a known weight on the scale (e.g. 1000g)"));`,
      `  delay(10000);`,
      ``,
      `  float loadSum = 0;`,
      `  samples = 0;`,
      `  calStart = millis();`,
      `  while (millis() - calStart < 5000) {`,
      `    loadSum += analogRead(A0);`,
      `    samples++;`,
      `    delay(10);`,
      `  }`,
      `  float loadRaw = loadSum / samples;`,
      `  float knownWeight = 1000.0; // grams — adjust as needed`,
      ``,
      `  if (abs(loadRaw - calibData.weightTare) > 0.001) {`,
      `    calibData.weightScale = knownWeight / (loadRaw - calibData.weightTare);`,
      `  } else {`,
      `    calibData.weightScale = 1.0;`,
      `  }`,
      ``,
      `  display_text("WEIGHT CALIBRATED", "Saved");`,
      `  Serial.print(F("Weight tare: ")); Serial.println(calibData.weightTare);`,
      `  Serial.print(F("Weight scale: ")); Serial.println(calibData.weightScale, 6);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── Color sensor calibration ──
  if (calibratableTypes.has("color_sensor")) {
    functions.push(
      `void calibrateColor() {`,
      `  display_text("COLOR CALIBRATE", "Place white card");`,
      `  Serial.println(F("Color calibration: place reference white card under sensor"));`,
      `  delay(5000);`,
      ``,
      `  // White balance — read RGB against known white`,
      `  float rSum = 0, gSum = 0, bSum = 0;`,
      `  int samples = 0;`,
      `  unsigned long calStart = millis();`,
      `  while (millis() - calStart < 5000) {`,
      `    // TODO: use actual TCS34725 raw reads`,
      `    rSum += 200; gSum += 200; bSum += 200; // placeholder`,
      `    samples++;`,
      `    delay(50);`,
      `  }`,
      ``,
      `  float rAvg = rSum / samples;`,
      `  float gAvg = gSum / samples;`,
      `  float bAvg = bSum / samples;`,
      ``,
      `  // Correction factors: target = 255 (white)`,
      `  if (rAvg > 0) calibData.colorR = 255.0 / rAvg;`,
      `  if (gAvg > 0) calibData.colorG = 255.0 / gAvg;`,
      `  if (bAvg > 0) calibData.colorB = 255.0 / bAvg;`,
      ``,
      `  display_text("COLOR CALIBRATED", "RGB saved");`,
      `  Serial.print(F("Color R: ")); Serial.println(calibData.colorR, 4);`,
      `  Serial.print(F("Color G: ")); Serial.println(calibData.colorG, 4);`,
      `  Serial.print(F("Color B: ")); Serial.println(calibData.colorB, 4);`,
      `  delay(2000);`,
      `}`,
      ``,
    );
  }

  // ── Master calibration sequence ──
  const sequenceCalls: string[] = [];
  if (calibratableTypes.has("pulse_oximeter")) sequenceCalls.push(`  calibrateSpo2();`);
  if (calibratableTypes.has("ecg")) sequenceCalls.push(`  calibrateECG();`);
  if (calibratableTypes.has("temperature_sensor")) sequenceCalls.push(`  calibrateTemp();`);
  if (calibratableTypes.has("blood_pressure")) sequenceCalls.push(`  calibratePressure();`);
  if (calibratableTypes.has("load_cell")) sequenceCalls.push(`  calibrateWeight();`);
  if (calibratableTypes.has("color_sensor")) sequenceCalls.push(`  calibrateColor();`);

  functions.push(
    `void runCalibrationSequence() {`,
    `  display_text("CALIBRATION", "Starting...");`,
    `  Serial.println(F("=== CALIBRATION SEQUENCE ==="));`,
    `  delay(2000);`,
    ``,
    ...sequenceCalls,
    ``,
    `  saveCalibration();`,
    `  display_text("CALIBRATION", "COMPLETE");`,
    `  Serial.println(F("=== CALIBRATION COMPLETE ==="));`,
    `  delay(3000);`,
    `}`,
    ``,
  );

  // ── Enter calibration mode (call from button handler) ──
  functions.push(
    `void checkCalibrationButton(bool buttonPressed) {`,
    `  if (buttonPressed) {`,
    `    if (calibBtnStart == 0) calibBtnStart = millis();`,
    `    if (millis() - calibBtnStart >= CALIB_HOLD_MS) {`,
    `      calibMode = true;`,
    `      calibBtnStart = 0;`,
    `    }`,
    `  } else {`,
    `    calibBtnStart = 0;`,
    `  }`,
    `}`,
  );

  return {
    includes,
    globals,
    setup,
    loop,
    functions,
  };
}

// ─── Generator Map ───────────────────────────────────────────

const GENERATORS: Record<string, (comp: Component) => CodeBlock> = {
  led: generateLEDCode,
  button: generateButtonCode,
  oled: generateOLEDCode,
  buzzer: generateBuzzerCode,
  sensor: generateSensorCode,
  servo: generateServoCode,
  neopixel: generateNeoPixelCode,
  relay: generateRelayCode,
  motor: generateMotorCode,
  gps: generateGPSCode,
  rfid: generateRFIDCode,
  pir: generatePIRCode,
  speaker: generateSpeakerCode,
  microphone: generateMicrophoneCode,
  ir_receiver: generateIRReceiverCode,
  ir_emitter: generateIREmitterCode,
  potentiometer: generatePotentiometerCode,
  ldr: generateLDRCode,
  ultrasonic: generateUltrasonicCode,
  moisture: generateMoistureCode,
  gas_sensor: generateGasSensorCode,
  lcd: generateLCDCode,
  stepper: generateStepperCode,
  encoder: generateEncoderCode,
  temperature_sensor: generateTemperatureSensorCode,
  thermocouple: generateThermocoupleCode,
  joystick: generateJoystickCode,
  pulse_oximeter: generatePulseOximeterCode,
  ecg: generateECGCode,
  blood_pressure: generateBloodPressureCode,
  load_cell: generateLoadCellCode,
  color_sensor: generateColorSensorCode,
};

// ─── MeshCue Connect Client Code Generator ──────────────────

function generateConnectClientCode(doc: MHDLDocument): CodeBlock {
  const gatewayUrl = doc.firmware?.connectGatewayUrl || "https://connect.meshcue.com";
  const deviceId = doc.firmware?.connectDeviceId || "forge-device-001";
  const thresholds = doc.firmware?.connectAlertThresholds || {};

  const includes = ["WiFi.h", "HTTPClient.h"];

  const globals: string[] = [
    `// MeshCue Connect — patient alert system`,
    `const char* CONNECT_GATEWAY = "${gatewayUrl}";`,
    `const char* DEVICE_ID = "${deviceId}";`,
    `unsigned long lastAlertMs = 0;`,
    `const unsigned long ALERT_COOLDOWN_MS = 60000; // 1 min between same alerts`,
  ];

  const functions: string[] = [
    `void sendConnectAlert(const char* reading, float value, const char* unit, const char* severity) {`,
    `  if (WiFi.status() != WL_CONNECTED) return;`,
    `  if (millis() - lastAlertMs < ALERT_COOLDOWN_MS) return;`,
    ``,
    `  HTTPClient http;`,
    `  http.begin(String(CONNECT_GATEWAY) + "/api/alert");`,
    `  http.addHeader("Content-Type", "application/json");`,
    ``,
    `  String payload = "{\\"deviceId\\":\\"" + String(DEVICE_ID) + "\\","`,
    `    "\\"reading\\":\\"" + String(reading) + "\\","`,
    `    "\\"value\\":" + String(value) + ","`,
    `    "\\"unit\\":\\"" + String(unit) + "\\","`,
    `    "\\"severity\\":\\"" + String(severity) + "\\"}";`,
    ``,
    `  int code = http.POST(payload);`,
    `  if (code == 200) lastAlertMs = millis();`,
    `  http.end();`,
    `}`,
  ];

  // Generate threshold-checking loop code based on what sensors / thresholds are configured
  const loop: string[] = [
    ``,
    `  // ── MeshCue Connect threshold checks ──`,
  ];

  // SpO2 thresholds (pulse_oximeter)
  if (thresholds["spo2_low"]) {
    const w = thresholds["spo2_low"].warning;
    const c = thresholds["spo2_low"].critical;
    loop.push(
      `  // SpO2 threshold check`,
      `  if (sensor_spo2_value > 0) {`,
      `    if (sensor_spo2_value < ${c}) {`,
      `      sendConnectAlert("SpO2", sensor_spo2_value, "%", "critical");`,
      `    } else if (sensor_spo2_value < ${w}) {`,
      `      sendConnectAlert("SpO2", sensor_spo2_value, "%", "warning");`,
      `    }`,
      `  }`,
    );
  }

  // Heart rate thresholds (ecg_monitor)
  if (thresholds["hr_high"] || thresholds["hr_low"]) {
    loop.push(`  // Heart rate threshold check`);
    loop.push(`  if (sensor_ecg_value > 0) {`);
    if (thresholds["hr_high"]) {
      const w = thresholds["hr_high"].warning;
      const c = thresholds["hr_high"].critical;
      loop.push(
        `    if (sensor_ecg_value > ${c}) {`,
        `      sendConnectAlert("HeartRate", sensor_ecg_value, "bpm", "critical");`,
        `    } else if (sensor_ecg_value > ${w}) {`,
        `      sendConnectAlert("HeartRate", sensor_ecg_value, "bpm", "warning");`,
        `    }`,
      );
    }
    if (thresholds["hr_low"]) {
      const w = thresholds["hr_low"].warning;
      const c = thresholds["hr_low"].critical;
      loop.push(
        `    if (sensor_ecg_value < ${c}) {`,
        `      sendConnectAlert("HeartRate", sensor_ecg_value, "bpm", "critical");`,
        `    } else if (sensor_ecg_value < ${w}) {`,
        `      sendConnectAlert("HeartRate", sensor_ecg_value, "bpm", "warning");`,
        `    }`,
      );
    }
    loop.push(`  }`);
  }

  // Temperature thresholds (thermometer_clinical, infant_warmer_controller)
  if (thresholds["temp_high"] || thresholds["temp_low"]) {
    loop.push(`  // Temperature threshold check`);
    loop.push(`  if (sensor_temp_value > 0) {`);
    if (thresholds["temp_high"]) {
      const w = thresholds["temp_high"].warning;
      const c = thresholds["temp_high"].critical;
      loop.push(
        `    if (sensor_temp_value > ${c}) {`,
        `      sendConnectAlert("Temperature", sensor_temp_value, "C", "critical");`,
        `    } else if (sensor_temp_value > ${w}) {`,
        `      sendConnectAlert("Temperature", sensor_temp_value, "C", "warning");`,
        `    }`,
      );
    }
    if (thresholds["temp_low"]) {
      const w = thresholds["temp_low"].warning;
      const c = thresholds["temp_low"].critical;
      loop.push(
        `    if (sensor_temp_value < ${c}) {`,
        `      sendConnectAlert("Temperature", sensor_temp_value, "C", "critical");`,
        `    } else if (sensor_temp_value < ${w}) {`,
        `      sendConnectAlert("Temperature", sensor_temp_value, "C", "warning");`,
        `    }`,
      );
    }
    loop.push(`  }`);
  }

  // Blood pressure thresholds
  if (thresholds["systolic_high"]) {
    const w = thresholds["systolic_high"].warning;
    const c = thresholds["systolic_high"].critical;
    loop.push(
      `  // Blood pressure threshold check`,
      `  if (sensor_pressure_value > 0) {`,
      `    if (sensor_pressure_value > ${c}) {`,
      `      sendConnectAlert("Systolic", sensor_pressure_value, "mmHg", "critical");`,
      `    } else if (sensor_pressure_value > ${w}) {`,
      `      sendConnectAlert("Systolic", sensor_pressure_value, "mmHg", "warning");`,
      `    }`,
      `  }`,
    );
  }

  return { includes, globals, setup: [], loop, functions };
}

// ─── Main Generator ──────────────────────────────────────────

export function generateArduinoFirmware(doc: MHDLDocument): BuildArtifact[] {
  const artifacts: BuildArtifact[] = [];

  // Collect code blocks from all components
  const blocks: CodeBlock[] = [];
  for (const comp of doc.board.components) {
    const gen = GENERATORS[comp.type];
    if (gen) {
      blocks.push(gen(comp));
    }
  }

  // Medical calibration: inject CalibrationManager when meta.medical is set
  if (doc.meta?.medical) {
    const calibratablePresent = new Set<string>();
    for (const comp of doc.board.components) {
      if (MEDICAL_CALIBRATABLE_TYPES.has(comp.type)) {
        calibratablePresent.add(comp.type);
      }
    }
    if (calibratablePresent.size > 0) {
      blocks.push(generateCalibrationManagerCode(calibratablePresent));
    }
  }

  // MeshCue Connect: inject alert client when connectEnabled
  if (doc.firmware?.connectEnabled || doc.meta?.connectEnabled) {
    blocks.push(generateConnectClientCode(doc));
  }

  // Merge all includes
  const allIncludes = new Set<string>();
  allIncludes.add("Arduino.h");
  for (const block of blocks) {
    for (const inc of block.includes) {
      allIncludes.add(inc);
    }
  }

  // Build the sketch
  const lines: string[] = [];

  // Medical device disclaimer (if applicable)
  if (doc.meta?.medical) {
    lines.push(`/*`);
    lines.push(` * ⚠️ MEDICAL DEVICE DISCLAIMER`);
    lines.push(` * This firmware was auto-generated by MeshCue Forge and is intended as a`);
    lines.push(` * DESIGN AID AND PROTOTYPE STARTING POINT ONLY. It is NOT a certified`);
    lines.push(` * medical device. Clinical validation, sensor calibration, and regulatory`);
    lines.push(` * approval are REQUIRED before any patient use. The developers assume no`);
    lines.push(` * liability for clinical outcomes. See WHO_CHECKLIST.md for regulatory guidance.`);
    lines.push(` */`);
    lines.push(``);
  }

  // Header
  lines.push(`/**`);
  lines.push(` * ${doc.meta.name} — Firmware`);
  lines.push(` * ${doc.meta.description}`);
  lines.push(` * Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
  lines.push(` */`);
  lines.push(``);

  // Includes
  for (const inc of allIncludes) {
    lines.push(libraryInclude(inc));
  }

  // Medical safety: include ESP32 hardware watchdog timer
  if (doc.meta?.medical) {
    lines.push(`#include <esp_task_wdt.h>  // Medical safety: hardware watchdog timer`);
  }
  lines.push(``);

  // Pin definitions
  lines.push(`// ─── Pin Definitions ───────────────────────────`);
  const allComponents = [doc.board.mcu, ...doc.board.components];
  for (const comp of allComponents) {
    for (const pin of comp.pins) {
      if (pin.gpio !== undefined) {
        lines.push(pinDefine(comp, pin));
      }
    }
  }
  lines.push(``);

  // Globals
  lines.push(`// ─── Globals ──────────────────────────────────`);
  lines.push(`unsigned long lastUpdate = 0;`);
  lines.push(`const unsigned long UPDATE_INTERVAL = 1000;`);
  for (const block of blocks) {
    for (const g of block.globals) {
      lines.push(g);
    }
  }
  lines.push(``);

  // Setup
  lines.push(`void setup() {`);
  lines.push(`  Serial.begin(115200);`);
  lines.push(`  Serial.println(F("${doc.meta.name} starting..."));`);
  lines.push(``);

  // Medical safety: hardware watchdog — resets device if firmware hangs
  if (doc.meta?.medical) {
    lines.push(`  // Medical safety: hardware watchdog — resets if firmware hangs for >30s`);
    lines.push(`  // This ensures the device cannot silently freeze in a medical context.`);
    lines.push(`  // If the main loop stops calling esp_task_wdt_reset(), the ESP32 will`);
    lines.push(`  // automatically reboot, preventing indefinite unresponsive states.`);
    lines.push(`  esp_task_wdt_init(30, true);  // 30 second timeout, panic on timeout`);
    lines.push(`  esp_task_wdt_add(NULL);       // Add current task to watchdog`);
    lines.push(``);
  }

  for (const block of blocks) {
    for (const s of block.setup) {
      lines.push(s);
    }
    if (block.setup.length > 0) lines.push(``);
  }
  lines.push(`  Serial.println(F("Ready."));`);
  lines.push(`}`);
  lines.push(``);

  // Loop
  lines.push(`void loop() {`);

  // Medical safety: feed the watchdog at the top of each loop iteration
  if (doc.meta?.medical) {
    lines.push(`  esp_task_wdt_reset();  // Feed the watchdog — must be called every <30s`);
    lines.push(``);
  }
  for (const block of blocks) {
    for (const l of block.loop) {
      lines.push(l);
    }
  }
  lines.push(``);
  lines.push(`  // Periodic update`);
  lines.push(`  if (millis() - lastUpdate >= UPDATE_INTERVAL) {`);
  lines.push(`    lastUpdate = millis();`);
  lines.push(`    // TODO: Add your periodic logic here`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  delay(10);`);
  lines.push(`}`);
  lines.push(``);

  // Helper functions
  lines.push(`// ─── Functions ────────────────────────────────`);
  for (const block of blocks) {
    for (const f of block.functions) {
      lines.push(f);
    }
    if (block.functions.length > 0) lines.push(``);
  }

  artifacts.push({
    stage: "firmware",
    filename: doc.firmware.entrypoint,
    content: lines.join("\n"),
    format: "arduino",
  });

  // Generate platformio.ini if using platformio
  if (doc.firmware.framework === "arduino" || doc.firmware.framework === "platformio") {
    const boardMap: Record<string, string> = {
      "esp32": "esp32dev",
      "esp32-s3": "esp32-s3-devkitc-1",
      "esp32-c3": "esp32-c3-devkitm-1",
      "arduino-uno": "uno",
      "arduino-nano": "nanoatmega328",
      "arduino-mega": "megaatmega2560",
      "rp2040": "pico",
    };

    const iniLines: string[] = [
      `; ${doc.meta.name} — PlatformIO Configuration`,
      `; Generated by MeshCue Forge`,
      ``,
      `[env:default]`,
      `platform = ${doc.board.mcu.family.startsWith("esp32") ? "espressif32" : doc.board.mcu.family.startsWith("arduino") ? "atmelavr" : "raspberrypi"}`,
      `board = ${doc.firmware.boardId || boardMap[doc.board.mcu.family] || "esp32dev"}`,
      `framework = arduino`,
      `monitor_speed = 115200`,
    ];

    if (doc.firmware.libraries.length > 0) {
      iniLines.push(`lib_deps =`);
      for (const lib of doc.firmware.libraries) {
        iniLines.push(`  ${lib.name}${lib.version ? `@${lib.version}` : ""}`);
      }
    }

    if (doc.firmware.buildFlags && doc.firmware.buildFlags.length > 0) {
      iniLines.push(`build_flags =`);
      for (const flag of doc.firmware.buildFlags) {
        iniLines.push(`  ${flag}`);
      }
    }

    artifacts.push({
      stage: "firmware",
      filename: "platformio.ini",
      content: iniLines.join("\n"),
      format: "ini",
    });
  }

  return artifacts;
}
