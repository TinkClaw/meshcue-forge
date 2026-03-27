# MeshCue Node — Assembly Instructions

## Components Needed

| # | Component | Type | Notes |
|---|-----------|------|-------|
| 1 | ESP32-S3-DevKitC-1 | MCU | Main controller |
| 2 | led_green | led | green |
| 3 | led_yellow | led | yellow |
| 4 | led_red | led | red |
| 5 | oled | oled |  |
| 6 | btn_pair | button |  |
| 7 | btn_reset | button |  |
| 8 | buzzer | buzzer |  |

## Wiring Steps

1. Connect **mcu.led_green_anode** → **led_green.anode**
2. Connect **mcu.led_yellow_anode** → **led_yellow.anode**
3. Connect **mcu.led_red_anode** → **led_red.anode**
4. Connect **mcu.oled_sda** → **oled.sda**
5. Connect **mcu.oled_scl** → **oled.scl**
6. Connect **mcu.btn_pair_sig** → **btn_pair.sig**
7. Connect **mcu.btn_reset_sig** → **btn_reset.sig**
8. Connect **mcu.buzzer_sig** → **buzzer.sig**

## Enclosure

- Type: snap-fit
- Material: PETG
- Wall thickness: 2.5mm
- Print the base first, then the lid
- Use m3-inserts for mounting the PCB

### Cutouts
- **led-hole** on front wall (for led_green)
- **led-hole** on front wall (for led_yellow)
- **led-hole** on front wall (for led_red)
- **oled-window** on front wall (for oled)
- **button-cap** on front wall (for btn_pair)
- **button-cap** on front wall (for btn_reset)
- **usb-c** on back wall (for mcu)