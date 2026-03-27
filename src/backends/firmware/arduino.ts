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
};

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
