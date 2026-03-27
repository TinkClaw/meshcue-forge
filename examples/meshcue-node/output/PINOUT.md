# MeshCue Node — Pinout Reference

| GPIO | Component | Pin | Mode |
|------|-----------|-----|------|
| 1 | mcu | led_green_anode | digital-out |
| 2 | mcu | led_yellow_anode | digital-out |
| 3 | mcu | led_red_anode | digital-out |
| 8 | mcu | oled_sda | i2c-sda |
| 9 | mcu | oled_scl | i2c-scl |
| 4 | mcu | btn_pair_sig | digital-in |
| 5 | mcu | btn_reset_sig | digital-in |
| 6 | mcu | buzzer_sig | pwm |
| 1 | led_green | anode | digital-out |
| 2 | led_yellow | anode | digital-out |
| 3 | led_red | anode | digital-out |
| 8 | oled | sda | i2c-sda |
| 9 | oled | scl | i2c-scl |
| 4 | btn_pair | sig | digital-in |
| 5 | btn_reset | sig | digital-in |
| 6 | buzzer | sig | pwm |

## Connections

| From | To | Type |
|------|----|------|
| mcu.led_green_anode | led_green.anode | wire |
| mcu.led_yellow_anode | led_yellow.anode | wire |
| mcu.led_red_anode | led_red.anode | wire |
| mcu.oled_sda | oled.sda | wire |
| mcu.oled_scl | oled.scl | wire |
| mcu.btn_pair_sig | btn_pair.sig | wire |
| mcu.btn_reset_sig | btn_reset.sig | wire |
| mcu.buzzer_sig | buzzer.sig | wire |