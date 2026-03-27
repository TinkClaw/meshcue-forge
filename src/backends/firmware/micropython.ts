/**
 * MicroPython Firmware Backend
 *
 * Converts MHDL board + firmware spec -> MicroPython main.py and boot.py
 * with proper imports, pin setup, and main loop.
 */

import type { MHDLDocument, BuildArtifact, Component } from "../../schema/mhdl.js";

// ─── Code Generation Helpers ─────────────────────────────────

interface PyCodeBlock {
  imports: string[];
  globals: string[];
  setup: string[];
  loop: string[];
  functions: string[];
}

function emptyBlock(): PyCodeBlock {
  return { imports: [], globals: [], setup: [], loop: [], functions: [] };
}

function pinRef(comp: Component, pinId: string): string {
  const pin = comp.pins.find((p) => p.id === pinId);
  return String(pin?.gpio ?? 0);
}

// ─── Component-specific generators ──────────────────────────

function generateLEDCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin"],
    globals: [
      `${comp.id}_pin = Pin(${gpio}, Pin.OUT)`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def set_${comp.id}(on):`,
      `    ${comp.id}_pin.value(1 if on else 0)`,
      ``,
    ],
  };
}

function generateButtonCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin", "import time"],
    globals: [
      `${comp.id}_pin = Pin(${gpio}, Pin.IN, Pin.PULL_UP)`,
      `${comp.id}_pressed = False`,
      `${comp.id}_last = False`,
      `${comp.id}_debounce = 0`,
    ],
    setup: [],
    loop: [
      `    # ${comp.id} debounce`,
      `    _read = not ${comp.id}_pin.value()`,
      `    if _read != ${comp.id}_last:`,
      `        ${comp.id}_debounce = time.ticks_ms()`,
      `    if time.ticks_diff(time.ticks_ms(), ${comp.id}_debounce) > 50:`,
      `        ${comp.id}_pressed = _read`,
      `    ${comp.id}_last = _read`,
    ],
    functions: [],
  };
}

function generateOLEDCode(comp: Component): PyCodeBlock {
  const sdaPin = comp.pins.find((p) => p.mode === "i2c-sda");
  const sclPin = comp.pins.find((p) => p.mode === "i2c-scl");
  const addr = comp.properties?.["i2cAddress"] || "0x3C";
  const width = comp.properties?.["width"] ?? 128;
  const height = comp.properties?.["height"] ?? 64;

  const sdaGpio = sdaPin?.gpio ?? 21;
  const sclGpio = sclPin?.gpio ?? 22;

  return {
    imports: ["from machine import Pin, I2C", "import ssd1306"],
    globals: [
      `${comp.id}_i2c = I2C(0, scl=Pin(${sclGpio}), sda=Pin(${sdaGpio}))`,
      `${comp.id}_oled = ssd1306.SSD1306_I2C(${width}, ${height}, ${comp.id}_i2c, addr=${addr})`,
    ],
    setup: [
      `    ${comp.id}_oled.fill(0)`,
      `    ${comp.id}_oled.text("${comp.properties?.["startupText"] || "MeshCue Forge"}", 0, 0)`,
      `    ${comp.id}_oled.show()`,
    ],
    loop: [],
    functions: [
      `def ${comp.id}_display(line1, line2=""):`,
      `    ${comp.id}_oled.fill(0)`,
      `    ${comp.id}_oled.text(line1, 0, 0)`,
      `    ${comp.id}_oled.text(line2, 0, 16)`,
      `    ${comp.id}_oled.show()`,
      ``,
    ],
  };
}

function generateBuzzerCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm" || p.mode === "digital-out");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin, PWM", "import time"],
    globals: [
      `${comp.id}_pwm = PWM(Pin(${gpio}))`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def beep(frequency=1000, duration_ms=100):`,
      `    ${comp.id}_pwm.freq(frequency)`,
      `    ${comp.id}_pwm.duty_u16(32768)`,
      `    time.sleep_ms(duration_ms)`,
      `    ${comp.id}_pwm.duty_u16(0)`,
      ``,
      `def beep_success():`,
      `    beep(1000, 100); time.sleep_ms(50); beep(1500, 100)`,
      ``,
      `def beep_error():`,
      `    beep(400, 300)`,
      ``,
    ],
  };
}

function generateSensorCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in" || p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const model = (comp.model || "dht22").toLowerCase();

  if (model.includes("dht")) {
    const dhtClass = model.includes("dht11") ? "DHT11" : "DHT22";
    return {
      imports: ["from machine import Pin", "import dht"],
      globals: [
        `${comp.id}_sensor = dht.${dhtClass}(Pin(${gpio}))`,
        `${comp.id}_temp = 0`,
        `${comp.id}_hum = 0`,
      ],
      setup: [],
      loop: [
        `    try:`,
        `        ${comp.id}_sensor.measure()`,
        `        ${comp.id}_temp = ${comp.id}_sensor.temperature()`,
        `        ${comp.id}_hum = ${comp.id}_sensor.humidity()`,
        `    except OSError:`,
        `        pass`,
      ],
      functions: [],
    };
  }

  return {
    imports: ["from machine import Pin, ADC"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_value = 0`,
    ],
    setup: [],
    loop: [
      `    ${comp.id}_value = ${comp.id}_adc.read()`,
    ],
    functions: [],
  };
}

function generateServoCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const minAngle = comp.properties?.["minAngle"] ?? 0;
  const maxAngle = comp.properties?.["maxAngle"] ?? 180;

  return {
    imports: ["from machine import Pin, PWM", "import time"],
    globals: [
      `${comp.id}_pwm = PWM(Pin(${gpio}), freq=50)`,
      `${comp.id}_angle = 0`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def ${comp.id}_set_angle(angle):`,
      `    global ${comp.id}_angle`,
      `    angle = max(${minAngle}, min(${maxAngle}, angle))`,
      `    duty = int(((angle / 180) * 2 + 0.5) / 20 * 65535)`,
      `    ${comp.id}_pwm.duty_u16(duty)`,
      `    ${comp.id}_angle = angle`,
      ``,
      `def ${comp.id}_sweep():`,
      `    for a in range(${minAngle}, ${maxAngle} + 1):`,
      `        ${comp.id}_set_angle(a)`,
      `        time.sleep_ms(15)`,
      `    for a in range(${maxAngle}, ${minAngle} - 1, -1):`,
      `        ${comp.id}_set_angle(a)`,
      `        time.sleep_ms(15)`,
      ``,
    ],
  };
}

function generateNeoPixelCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const numLeds = comp.properties?.["numLeds"] ?? 8;
  const brightness = comp.properties?.["brightness"] ?? 50;

  return {
    imports: ["from machine import Pin", "import neopixel", "import time"],
    globals: [
      `${comp.id}_np = neopixel.NeoPixel(Pin(${gpio}), ${numLeds})`,
      `${comp.id}_brightness = ${brightness}`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def ${comp.id}_set_color(r, g, b):`,
      `    s = ${comp.id}_brightness / 255`,
      `    for i in range(${numLeds}):`,
      `        ${comp.id}_np[i] = (int(r * s), int(g * s), int(b * s))`,
      `    ${comp.id}_np.write()`,
      ``,
      `def ${comp.id}_rainbow(wait_ms=10):`,
      `    for j in range(256):`,
      `        for i in range(${numLeds}):`,
      `            idx = (i * 256 // ${numLeds} + j) & 255`,
      `            if idx < 85:`,
      `                ${comp.id}_np[i] = (idx * 3, 255 - idx * 3, 0)`,
      `            elif idx < 170:`,
      `                idx -= 85`,
      `                ${comp.id}_np[i] = (255 - idx * 3, 0, idx * 3)`,
      `            else:`,
      `                idx -= 170`,
      `                ${comp.id}_np[i] = (0, idx * 3, 255 - idx * 3)`,
      `        ${comp.id}_np.write()`,
      `        time.sleep_ms(wait_ms)`,
      ``,
    ],
  };
}

function generateRelayCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const activeLow = comp.properties?.["activeLow"] === true;

  return {
    imports: ["from machine import Pin", "import time"],
    globals: [
      `${comp.id}_pin = Pin(${gpio}, Pin.OUT)`,
      `${comp.id}_state = False`,
    ],
    setup: [
      `    ${comp.id}_pin.value(${activeLow ? 1 : 0})  # Start OFF`,
    ],
    loop: [],
    functions: [
      `def ${comp.id}_set(on):`,
      `    global ${comp.id}_state`,
      `    ${comp.id}_state = on`,
      `    ${comp.id}_pin.value(${activeLow ? "0 if on else 1" : "1 if on else 0"})`,
      `    time.sleep_ms(50)  # Safety delay`,
      ``,
    ],
  };
}

function generateMotorCode(comp: Component): PyCodeBlock {
  const pwmPin = comp.pins.find((p) => p.mode === "pwm");
  const in1Pin = comp.pins.find((p) => p.id === "in1" || p.id === "dir1");
  const in2Pin = comp.pins.find((p) => p.id === "in2" || p.id === "dir2");
  if (!pwmPin) return emptyBlock();
  const pwmGpio = pwmPin.gpio ?? 0;

  const globals = [
    `${comp.id}_pwm = PWM(Pin(${pwmGpio}), freq=1000)`,
  ];
  if (in1Pin) globals.push(`${comp.id}_in1 = Pin(${in1Pin.gpio ?? 0}, Pin.OUT)`);
  if (in2Pin) globals.push(`${comp.id}_in2 = Pin(${in2Pin.gpio ?? 0}, Pin.OUT)`);

  const fnLines = [
    `def ${comp.id}_set_speed(speed):`,
    `    # speed: -255 to 255`,
    `    abs_speed = min(abs(speed), 255)`,
  ];
  if (in1Pin && in2Pin) {
    fnLines.push(
      `    if speed > 0:`,
      `        ${comp.id}_in1.value(1)`,
      `        ${comp.id}_in2.value(0)`,
      `    elif speed < 0:`,
      `        ${comp.id}_in1.value(0)`,
      `        ${comp.id}_in2.value(1)`,
      `    else:`,
      `        ${comp.id}_in1.value(0)`,
      `        ${comp.id}_in2.value(0)`,
    );
  }
  fnLines.push(
    `    ${comp.id}_pwm.duty_u16(abs_speed * 257)`,
    ``,
    `def ${comp.id}_stop():`,
  );
  if (in1Pin) fnLines.push(`    ${comp.id}_in1.value(0)`);
  if (in2Pin) fnLines.push(`    ${comp.id}_in2.value(0)`);
  fnLines.push(
    `    ${comp.id}_pwm.duty_u16(0)`,
    ``,
  );

  return {
    imports: ["from machine import Pin, PWM"],
    globals,
    setup: [],
    loop: [],
    functions: fnLines,
  };
}

function generateGPSCode(comp: Component): PyCodeBlock {
  const txPin = comp.pins.find((p) => p.mode === "uart-tx");
  const rxPin = comp.pins.find((p) => p.mode === "uart-rx");
  const txGpio = txPin?.gpio ?? 16;
  const rxGpio = rxPin?.gpio ?? 17;
  const baud = comp.properties?.["baud"] ?? 9600;

  return {
    imports: ["from machine import UART, Pin", "import time"],
    globals: [
      `${comp.id}_uart = UART(1, baudrate=${baud}, tx=Pin(${txGpio}), rx=Pin(${rxGpio}))`,
      `${comp.id}_lat = 0.0`,
      `${comp.id}_lon = 0.0`,
      `${comp.id}_speed = 0.0`,
    ],
    setup: [],
    loop: [
      `    # ${comp.id} GPS parse NMEA`,
      `    if ${comp.id}_uart.any():`,
      `        line = ${comp.id}_uart.readline()`,
      `        if line:`,
      `            try:`,
      `                msg = line.decode("ascii").strip()`,
      `                if msg.startswith("$GPGGA") or msg.startswith("$GNGGA"):`,
      `                    parts = msg.split(",")`,
      `                    if len(parts) > 5 and parts[2]:`,
      `                        lat_raw = float(parts[2])`,
      `                        ${comp.id}_lat = int(lat_raw / 100) + (lat_raw % 100) / 60`,
      `                        if parts[3] == "S": ${comp.id}_lat = -${comp.id}_lat`,
      `                        lon_raw = float(parts[4])`,
      `                        ${comp.id}_lon = int(lon_raw / 100) + (lon_raw % 100) / 60`,
      `                        if parts[5] == "W": ${comp.id}_lon = -${comp.id}_lon`,
      `            except:`,
      `                pass`,
    ],
    functions: [],
  };
}

function generateRFIDCode(comp: Component): PyCodeBlock {
  const csPin = comp.pins.find((p) => p.mode === "spi-cs");
  const rstPin = comp.pins.find((p) => p.id === "rst" || p.id === "reset");
  const csGpio = csPin?.gpio ?? 5;
  const rstGpio = rstPin?.gpio ?? 0;

  return {
    imports: ["from machine import Pin, SPI", "import mfrc522", "import time"],
    globals: [
      `${comp.id}_spi = SPI(1, baudrate=2500000, polarity=0, phase=0)`,
      `${comp.id}_rfid = mfrc522.MFRC522(${comp.id}_spi, cs=Pin(${csGpio}, Pin.OUT), rst=Pin(${rstGpio}, Pin.OUT))`,
      `${comp.id}_uid = ""`,
    ],
    setup: [],
    loop: [
      `    # ${comp.id} RFID check`,
      `    (stat, _) = ${comp.id}_rfid.request(${comp.id}_rfid.REQIDL)`,
      `    if stat == ${comp.id}_rfid.OK:`,
      `        (stat, raw_uid) = ${comp.id}_rfid.anticoll()`,
      `        if stat == ${comp.id}_rfid.OK:`,
      `            ${comp.id}_uid = "".join(["{:02X}".format(b) for b in raw_uid])`,
      `            print("RFID UID:", ${comp.id}_uid)`,
    ],
    functions: [],
  };
}

function generatePIRCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const debounceMs = comp.properties?.["debounceMs"] ?? 2000;

  return {
    imports: ["from machine import Pin", "import time"],
    globals: [
      `${comp.id}_pin = Pin(${gpio}, Pin.IN)`,
      `${comp.id}_motion = False`,
      `${comp.id}_last_trigger = 0`,
    ],
    setup: [
      `    time.sleep(2)  # PIR warm-up`,
    ],
    loop: [
      `    # ${comp.id} motion detection`,
      `    if ${comp.id}_pin.value() and time.ticks_diff(time.ticks_ms(), ${comp.id}_last_trigger) > ${debounceMs}:`,
      `        ${comp.id}_motion = True`,
      `        ${comp.id}_last_trigger = time.ticks_ms()`,
      `        print("Motion detected!")`,
      `    elif time.ticks_diff(time.ticks_ms(), ${comp.id}_last_trigger) > ${debounceMs}:`,
      `        ${comp.id}_motion = False`,
    ],
    functions: [],
  };
}

function generateSpeakerCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "pwm" || p.mode === "digital-out");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin, PWM", "import time"],
    globals: [
      `${comp.id}_pwm = PWM(Pin(${gpio}))`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def ${comp.id}_play_tone(frequency, duration_ms):`,
      `    ${comp.id}_pwm.freq(frequency)`,
      `    ${comp.id}_pwm.duty_u16(32768)`,
      `    time.sleep_ms(duration_ms)`,
      `    ${comp.id}_pwm.duty_u16(0)`,
      ``,
      `def ${comp.id}_play_melody(notes, durations):`,
      `    for freq, dur in zip(notes, durations):`,
      `        if freq == 0:`,
      `            ${comp.id}_pwm.duty_u16(0)`,
      `        else:`,
      `            ${comp.id}_play_tone(freq, dur)`,
      `        time.sleep_ms(int(dur * 0.3))`,
      `    ${comp.id}_pwm.duty_u16(0)`,
      ``,
      `def ${comp.id}_stop():`,
      `    ${comp.id}_pwm.duty_u16(0)`,
      ``,
    ],
  };
}

function generateMicrophoneCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const threshold = comp.properties?.["threshold"] ?? 512;
  const sampleWindowMs = comp.properties?.["sampleWindowMs"] ?? 50;

  return {
    imports: ["from machine import Pin, ADC", "import time"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_value = 0`,
      `${comp.id}_peak = 0`,
      `${comp.id}_triggered = False`,
    ],
    setup: [],
    loop: [
      `    # ${comp.id} microphone sampling`,
      `    _mic_start = time.ticks_ms()`,
      `    _mic_min, _mic_max = 4095, 0`,
      `    while time.ticks_diff(time.ticks_ms(), _mic_start) < ${sampleWindowMs}:`,
      `        s = ${comp.id}_adc.read()`,
      `        if s > _mic_max: _mic_max = s`,
      `        if s < _mic_min: _mic_min = s`,
      `    ${comp.id}_peak = _mic_max - _mic_min`,
      `    ${comp.id}_value = (_mic_max + _mic_min) // 2`,
      `    ${comp.id}_triggered = ${comp.id}_peak > ${threshold}`,
    ],
    functions: [],
  };
}

function generateIRReceiverCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin", "from ir_rx.nec import NEC_8"],
    globals: [
      `${comp.id}_code = 0`,
      `${comp.id}_received = False`,
      ``,
      `def _${comp.id}_callback(data, addr, ctrl):`,
      `    global ${comp.id}_code, ${comp.id}_received`,
      `    ${comp.id}_code = data`,
      `    ${comp.id}_received = True`,
      `    print("IR code:", hex(data))`,
    ],
    setup: [
      `    ${comp.id}_ir = NEC_8(Pin(${gpio}, Pin.IN), _${comp.id}_callback)`,
    ],
    loop: [],
    functions: [],
  };
}

function generateIREmitterCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-out" || p.mode === "pwm");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin", "from ir_tx.nec import NEC"],
    globals: [
      `${comp.id}_nec = NEC(Pin(${gpio}, Pin.OUT, value=0))`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def ${comp.id}_send(address, command):`,
      `    ${comp.id}_nec.transmit(address, command)`,
      ``,
    ],
  };
}

function generatePotentiometerCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const mapMin = comp.properties?.["mapMin"] ?? 0;
  const mapMax = comp.properties?.["mapMax"] ?? 100;

  return {
    imports: ["from machine import Pin, ADC"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_raw = 0`,
      `${comp.id}_mapped = 0`,
    ],
    setup: [],
    loop: [
      `    ${comp.id}_raw = ${comp.id}_adc.read()`,
      `    ${comp.id}_mapped = int(${comp.id}_raw * (${mapMax} - ${mapMin}) / 4095 + ${mapMin})`,
    ],
    functions: [],
  };
}

function generateLDRCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const threshold = comp.properties?.["threshold"] ?? 500;

  return {
    imports: ["from machine import Pin, ADC"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_value = 0`,
      `${comp.id}_dark = False`,
    ],
    setup: [],
    loop: [
      `    ${comp.id}_value = ${comp.id}_adc.read()`,
      `    ${comp.id}_dark = ${comp.id}_value < ${threshold}`,
    ],
    functions: [],
  };
}

function generateUltrasonicCode(comp: Component): PyCodeBlock {
  const trigPin = comp.pins.find((p) => p.id === "trig" || p.id === "trigger");
  const echoPin = comp.pins.find((p) => p.id === "echo");
  if (!trigPin || !echoPin) return emptyBlock();
  const trigGpio = trigPin.gpio ?? 0;
  const echoGpio = echoPin.gpio ?? 0;

  return {
    imports: ["from machine import Pin, time_pulse_us", "import time"],
    globals: [
      `${comp.id}_trig = Pin(${trigGpio}, Pin.OUT)`,
      `${comp.id}_echo = Pin(${echoGpio}, Pin.IN)`,
      `${comp.id}_distance_cm = 0.0`,
    ],
    setup: [],
    loop: [
      `    # ${comp.id} ultrasonic distance`,
      `    ${comp.id}_trig.value(0)`,
      `    time.sleep_us(2)`,
      `    ${comp.id}_trig.value(1)`,
      `    time.sleep_us(10)`,
      `    ${comp.id}_trig.value(0)`,
      `    _us = time_pulse_us(${comp.id}_echo, 1, 30000)`,
      `    ${comp.id}_distance_cm = _us * 0.034 / 2 if _us > 0 else 0`,
    ],
    functions: [],
  };
}

function generateMoistureCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;

  return {
    imports: ["from machine import Pin, ADC"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_raw = 0`,
      `${comp.id}_percent = 0`,
    ],
    setup: [],
    loop: [
      `    ${comp.id}_raw = ${comp.id}_adc.read()`,
      `    ${comp.id}_percent = int((4095 - ${comp.id}_raw) * 100 / 4095)`,
    ],
    functions: [],
  };
}

function generateGasSensorCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const warmUpSec = comp.properties?.["warmUpSeconds"] ?? 20;
  const threshold = comp.properties?.["threshold"] ?? 400;

  return {
    imports: ["from machine import Pin, ADC", "import time"],
    globals: [
      `${comp.id}_adc = ADC(Pin(${gpio}))`,
      `${comp.id}_value = 0`,
      `${comp.id}_alert = False`,
      `${comp.id}_ready = False`,
      `${comp.id}_start_time = time.ticks_ms()`,
    ],
    setup: [
      `    print("Gas sensor warming up...")`,
    ],
    loop: [
      `    # ${comp.id} gas sensor`,
      `    if not ${comp.id}_ready and time.ticks_diff(time.ticks_ms(), ${comp.id}_start_time) > ${Number(warmUpSec) * 1000}:`,
      `        ${comp.id}_ready = True`,
      `        print("Gas sensor ready")`,
      `    if ${comp.id}_ready:`,
      `        ${comp.id}_value = ${comp.id}_adc.read()`,
      `        ${comp.id}_alert = ${comp.id}_value > ${threshold}`,
    ],
    functions: [],
  };
}

function generateLCDCode(comp: Component): PyCodeBlock {
  const addr = comp.properties?.["i2cAddress"] || "0x27";
  const cols = comp.properties?.["cols"] ?? 16;
  const rows = comp.properties?.["rows"] ?? 2;
  const sdaPin = comp.pins.find((p) => p.mode === "i2c-sda");
  const sclPin = comp.pins.find((p) => p.mode === "i2c-scl");
  const sdaGpio = sdaPin?.gpio ?? 21;
  const sclGpio = sclPin?.gpio ?? 22;

  return {
    imports: ["from machine import Pin, I2C", "from lcd_i2c import LCD"],
    globals: [
      `${comp.id}_i2c = I2C(0, scl=Pin(${sclGpio}), sda=Pin(${sdaGpio}))`,
      `${comp.id}_lcd = LCD(${comp.id}_i2c, ${addr}, ${rows}, ${cols})`,
    ],
    setup: [
      `    ${comp.id}_lcd.begin()`,
      `    ${comp.id}_lcd.backlight()`,
      `    ${comp.id}_lcd.print("${comp.properties?.["startupText"] || "MeshCue Forge"}")`,
    ],
    loop: [],
    functions: [
      `def ${comp.id}_print(col, row, text):`,
      `    ${comp.id}_lcd.set_cursor(col, row)`,
      `    ${comp.id}_lcd.print(text)`,
      ``,
      `def ${comp.id}_clear():`,
      `    ${comp.id}_lcd.clear()`,
      ``,
    ],
  };
}

function generateStepperCode(comp: Component): PyCodeBlock {
  const stepPin = comp.pins.find((p) => p.id === "step" || p.id === "stp");
  const dirPin = comp.pins.find((p) => p.id === "dir");
  if (!stepPin || !dirPin) return emptyBlock();
  const stepGpio = stepPin.gpio ?? 0;
  const dirGpio = dirPin.gpio ?? 0;
  const maxSpeed = comp.properties?.["maxSpeed"] ?? 1000;

  return {
    imports: ["from machine import Pin", "import time"],
    globals: [
      `${comp.id}_step_pin = Pin(${stepGpio}, Pin.OUT)`,
      `${comp.id}_dir_pin = Pin(${dirGpio}, Pin.OUT)`,
      `${comp.id}_position = 0`,
      `${comp.id}_delay_us = max(1, int(1000000 / ${maxSpeed}))`,
    ],
    setup: [],
    loop: [],
    functions: [
      `def ${comp.id}_move(steps, direction=1):`,
      `    global ${comp.id}_position`,
      `    ${comp.id}_dir_pin.value(direction)`,
      `    for _ in range(abs(steps)):`,
      `        ${comp.id}_step_pin.value(1)`,
      `        time.sleep_us(${comp.id}_delay_us)`,
      `        ${comp.id}_step_pin.value(0)`,
      `        time.sleep_us(${comp.id}_delay_us)`,
      `    ${comp.id}_position += steps if direction else -steps`,
      ``,
      `def ${comp.id}_set_speed(delay_us):`,
      `    global ${comp.id}_delay_us`,
      `    ${comp.id}_delay_us = max(1, delay_us)`,
      ``,
    ],
  };
}

function generateEncoderCode(comp: Component): PyCodeBlock {
  const clkPin = comp.pins.find((p) => p.id === "clk" || p.id === "a");
  const dtPin = comp.pins.find((p) => p.id === "dt" || p.id === "b");
  const swPin = comp.pins.find((p) => p.id === "sw" || p.id === "button");
  if (!clkPin || !dtPin) return emptyBlock();
  const clkGpio = clkPin.gpio ?? 0;
  const dtGpio = dtPin.gpio ?? 0;

  const globals = [
    `${comp.id}_clk = Pin(${clkGpio}, Pin.IN, Pin.PULL_UP)`,
    `${comp.id}_dt = Pin(${dtGpio}, Pin.IN, Pin.PULL_UP)`,
    `${comp.id}_position = 0`,
    `${comp.id}_last_clk = 1`,
  ];

  const loop = [
    `    # ${comp.id} encoder read`,
    `    _clk_val = ${comp.id}_clk.value()`,
    `    if _clk_val != ${comp.id}_last_clk and _clk_val == 0:`,
    `        if ${comp.id}_dt.value() != _clk_val:`,
    `            ${comp.id}_position += 1`,
    `        else:`,
    `            ${comp.id}_position -= 1`,
    `    ${comp.id}_last_clk = _clk_val`,
  ];

  if (swPin) {
    const swGpio = swPin.gpio ?? 0;
    globals.push(`${comp.id}_sw = Pin(${swGpio}, Pin.IN, Pin.PULL_UP)`);
    globals.push(`${comp.id}_button = False`);
    loop.push(`    ${comp.id}_button = not ${comp.id}_sw.value()`);
  }

  return {
    imports: ["from machine import Pin"],
    globals,
    setup: [],
    loop,
    functions: [],
  };
}

function generateTemperatureSensorCode(comp: Component): PyCodeBlock {
  const pin = comp.pins.find((p) => p.mode === "digital-in" || p.mode === "analog-in");
  if (!pin) return emptyBlock();
  const gpio = pin.gpio ?? 0;
  const model = (comp.model || "dht22").toLowerCase();

  if (model.includes("ds18b20") || model.includes("onewire")) {
    return {
      imports: ["from machine import Pin", "import onewire", "import ds18x20", "import time"],
      globals: [
        `${comp.id}_ow = onewire.OneWire(Pin(${gpio}))`,
        `${comp.id}_ds = ds18x20.DS18X20(${comp.id}_ow)`,
        `${comp.id}_roms = []`,
        `${comp.id}_temp_c = 0.0`,
      ],
      setup: [
        `    ${comp.id}_roms = ${comp.id}_ds.scan()`,
        `    print("DS18B20 devices:", ${comp.id}_roms)`,
      ],
      loop: [
        `    # ${comp.id} DS18B20`,
        `    ${comp.id}_ds.convert_temp()`,
        `    time.sleep_ms(750)`,
        `    if ${comp.id}_roms:`,
        `        ${comp.id}_temp_c = ${comp.id}_ds.read_temp(${comp.id}_roms[0])`,
      ],
      functions: [],
    };
  }

  const dhtClass = model.includes("dht11") ? "DHT11" : "DHT22";
  return {
    imports: ["from machine import Pin", "import dht"],
    globals: [
      `${comp.id}_sensor = dht.${dhtClass}(Pin(${gpio}))`,
      `${comp.id}_temp_c = 0.0`,
      `${comp.id}_humidity = 0.0`,
    ],
    setup: [],
    loop: [
      `    try:`,
      `        ${comp.id}_sensor.measure()`,
      `        ${comp.id}_temp_c = ${comp.id}_sensor.temperature()`,
      `        ${comp.id}_humidity = ${comp.id}_sensor.humidity()`,
      `    except OSError:`,
      `        pass`,
    ],
    functions: [],
  };
}

function generateThermocoupleCode(comp: Component): PyCodeBlock {
  const csPin = comp.pins.find((p) => p.mode === "spi-cs");
  const sckPin = comp.pins.find((p) => p.mode === "spi-sck");
  const soPin = comp.pins.find((p) => p.mode === "spi-miso");
  if (!csPin || !sckPin || !soPin) return emptyBlock();

  return {
    imports: ["from machine import Pin, SPI", "import max6675", "import time"],
    globals: [
      `${comp.id}_spi = SPI(1, baudrate=1000000, polarity=0, phase=0)`,
      `${comp.id}_cs = Pin(${csPin.gpio ?? 0}, Pin.OUT)`,
      `${comp.id}_tc = max6675.MAX6675(${comp.id}_spi, ${comp.id}_cs)`,
      `${comp.id}_temp_c = 0.0`,
    ],
    setup: [
      `    time.sleep_ms(500)  # MAX6675 stabilization`,
    ],
    loop: [
      `    ${comp.id}_temp_c = ${comp.id}_tc.read()`,
    ],
    functions: [],
  };
}

function generateJoystickCode(comp: Component): PyCodeBlock {
  const xPin = comp.pins.find((p) => p.id === "x" || p.id === "vrx");
  const yPin = comp.pins.find((p) => p.id === "y" || p.id === "vry");
  const swPin = comp.pins.find((p) => p.id === "sw" || p.id === "button");
  if (!xPin || !yPin) return emptyBlock();

  const globals = [
    `${comp.id}_x_adc = ADC(Pin(${xPin.gpio ?? 0}))`,
    `${comp.id}_y_adc = ADC(Pin(${yPin.gpio ?? 0}))`,
    `${comp.id}_x = 2048`,
    `${comp.id}_y = 2048`,
  ];

  const loop = [
    `    ${comp.id}_x = ${comp.id}_x_adc.read()`,
    `    ${comp.id}_y = ${comp.id}_y_adc.read()`,
  ];

  if (swPin) {
    globals.push(`${comp.id}_sw = Pin(${swPin.gpio ?? 0}, Pin.IN, Pin.PULL_UP)`);
    globals.push(`${comp.id}_button = False`);
    loop.push(`    ${comp.id}_button = not ${comp.id}_sw.value()`);
  }

  return {
    imports: ["from machine import Pin, ADC"],
    globals,
    setup: [],
    loop,
    functions: [],
  };
}

// ─── Generator Map ───────────────────────────────────────────

const GENERATORS: Record<string, (comp: Component) => PyCodeBlock> = {
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

export function generateMicroPythonFirmware(doc: MHDLDocument): BuildArtifact[] {
  const artifacts: BuildArtifact[] = [];

  // Collect code blocks from all components
  const blocks: PyCodeBlock[] = [];
  for (const comp of doc.board.components) {
    const gen = GENERATORS[comp.type];
    if (gen) {
      blocks.push(gen(comp));
    }
  }

  // Deduplicate imports
  const allImports = new Set<string>();
  allImports.add("import time");
  for (const block of blocks) {
    for (const imp of block.imports) {
      allImports.add(imp);
    }
  }

  // ─── Generate main.py ─────────────────────────────────────

  const lines: string[] = [];

  lines.push(`"""`)
  lines.push(`${doc.meta.name} -- MicroPython Firmware`);
  lines.push(`${doc.meta.description}`);
  lines.push(`Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
  lines.push(`"""`);
  lines.push(``);

  // Imports
  for (const imp of allImports) {
    lines.push(imp);
  }
  lines.push(``);

  // Globals
  lines.push(`# ─── Globals ──────────────────────────────────`);
  lines.push(`last_update = 0`);
  lines.push(`UPDATE_INTERVAL = 1000`);
  for (const block of blocks) {
    for (const g of block.globals) {
      lines.push(g);
    }
  }
  lines.push(``);

  // Functions
  const allFunctions: string[] = [];
  for (const block of blocks) {
    if (block.functions.length > 0) {
      allFunctions.push(...block.functions);
    }
  }
  if (allFunctions.length > 0) {
    lines.push(`# ─── Functions ────────────────────────────────`);
    for (const f of allFunctions) {
      lines.push(f);
    }
    lines.push(``);
  }

  // Setup
  lines.push(`# ─── Setup ────────────────────────────────────`);
  lines.push(`def setup():`);
  lines.push(`    print("${doc.meta.name} starting...")`);
  let hasSetup = false;
  for (const block of blocks) {
    for (const s of block.setup) {
      lines.push(s);
      hasSetup = true;
    }
  }
  if (!hasSetup) {
    lines.push(`    pass`);
  }
  lines.push(`    print("Ready.")`);
  lines.push(``);

  // Main loop
  lines.push(`# ─── Main Loop ────────────────────────────────`);
  lines.push(`def main():`);
  lines.push(`    global last_update`);
  lines.push(`    setup()`);
  lines.push(`    while True:`);

  let hasLoop = false;
  for (const block of blocks) {
    for (const l of block.loop) {
      lines.push(`    ${l}`);
      hasLoop = true;
    }
  }

  lines.push(``);
  lines.push(`        # Periodic update`);
  lines.push(`        now = time.ticks_ms()`);
  lines.push(`        if time.ticks_diff(now, last_update) >= UPDATE_INTERVAL:`);
  lines.push(`            last_update = now`);
  lines.push(`            # TODO: Add your periodic logic here`);
  lines.push(`            pass`);
  lines.push(``);
  lines.push(`        time.sleep_ms(10)`);
  lines.push(``);
  lines.push(`if __name__ == "__main__":`);
  lines.push(`    main()`);

  artifacts.push({
    stage: "firmware",
    filename: "main.py",
    content: lines.join("\n"),
    format: "python",
  });

  // ─── Generate boot.py (WiFi for ESP32) ────────────────────

  const mcuFamily = doc.board.mcu.family;
  if (mcuFamily.startsWith("esp32")) {
    const bootLines: string[] = [];
    bootLines.push(`"""`)
    bootLines.push(`${doc.meta.name} -- Boot Configuration`);
    bootLines.push(`Generated by MeshCue Forge v${doc.meta.schemaVersion}`);
    bootLines.push(`"""`);
    bootLines.push(``);
    bootLines.push(`import network`);
    bootLines.push(`import time`);
    bootLines.push(``);
    bootLines.push(`# WiFi Configuration`);
    bootLines.push(`WIFI_SSID = "YOUR_SSID"`);
    bootLines.push(`WIFI_PASS = "YOUR_PASSWORD"`);
    bootLines.push(``);
    bootLines.push(`def connect_wifi():`);
    bootLines.push(`    wlan = network.WLAN(network.STA_IF)`);
    bootLines.push(`    wlan.active(True)`);
    bootLines.push(`    if not wlan.isconnected():`);
    bootLines.push(`        print("Connecting to WiFi...")`);
    bootLines.push(`        wlan.connect(WIFI_SSID, WIFI_PASS)`);
    bootLines.push(`        timeout = 10`);
    bootLines.push(`        while not wlan.isconnected() and timeout > 0:`);
    bootLines.push(`            time.sleep(1)`);
    bootLines.push(`            timeout -= 1`);
    bootLines.push(`    if wlan.isconnected():`);
    bootLines.push(`        print("WiFi connected:", wlan.ifconfig())`);
    bootLines.push(`    else:`);
    bootLines.push(`        print("WiFi connection failed")`);
    bootLines.push(`    return wlan`);
    bootLines.push(``);
    bootLines.push(`# Uncomment to auto-connect on boot:`);
    bootLines.push(`# connect_wifi()`);

    artifacts.push({
      stage: "firmware",
      filename: "boot.py",
      content: bootLines.join("\n"),
      format: "python",
    });
  }

  return artifacts;
}
