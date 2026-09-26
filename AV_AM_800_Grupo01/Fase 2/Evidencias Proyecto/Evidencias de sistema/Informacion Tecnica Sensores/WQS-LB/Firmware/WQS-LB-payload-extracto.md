# WQS-LB/LS — Extracto de las secciones de payload del manual oficial

Transcripción de las secciones 2.2 y 2.3 de `WQS-LB-LS.pdf` (manual oficial de Dragino, versión online: https://docs.dragino.com/docs/LoRaWAN-End-Node/air-quality-water-quality-environmental/wqs-lb/), para poder leerlas sin herramientas de PDF. Las tablas se copian tal como aparecen en el manual. Las notas marcadas con **[Nota StormCIP]** no son del manual.

---

## 2.2 Uplink payload

Los uplinks son de dos tipos: valores válidos de sensores (FPort=2) y otros comandos de estado o control (FPort distinto de 2).

### 2.2.1 Uplink FPort=5, estado del dispositivo

Se envía al unirse a la red y luego cada 12 horas. También puede pedirse con el downlink `0x2601`.

| Tamaño (bytes) | 1 | 2 | 1 | 1 | 2 |
|---|---|---|---|---|---|
| Valor | Sensor Model | Firmware Version | Frequency Band | Sub-band | BAT |

Ejemplo (FPort=5): `3C 01 00 01 00 0D C8`

- **Sensor Model** (1 byte): para WQS-LB es `0x3C`.
- **Firmware Version** (2 bytes): `0x0100` significa v1.0.0.
- **Frequency Band** (1 byte): `0x01` EU868, `0x02` US915, `0x03` IN865, `0x04` AU915, `0x05` KZ865, `0x06` RU864, `0x07` AS923, `0x08` AS923-1, `0x09` AS923-2, `0x0a` AS923-3, `0x0b` CN470, `0x0c` EU433, `0x0d` KR920, `0x0e` MA869.
- **Sub-band** (1 byte): `0x00` a `0x08`, solo para CN470, AU915 y US915. En las demás bandas es `0x00`.
- **BAT** (2 bytes): voltaje de batería. Ejemplo: `0x0DC8 / 1000 = 3.528 V`.

### 2.2.2 Uplink FPort=2, valor del sensor en tiempo real

Se envía después del uplink de configuración y luego periódicamente (por defecto cada 20 minutos). El largo es dinámico y depende de las sondas conectadas.

| Tamaño (bytes) | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Valor | BAT | temperature DS18B20 | flag and Sensor Identifier | turbidity | dissolved oxygen | ORP | ECK10 | ECK10_temp | ECK1 | ECK1_temp | PH | PH_temp |

Ejemplo (FPort=2): `0CB4 0CCC 29 09CE 0002 02DE 0111`
El equipo tiene tres sondas conectadas: pH, ORP y turbidez.

- **BAT** (2 bytes): `0x0CB4 / 1000 = 3.252 V`.
- **Temperature** (2 bytes): sensor externo DS18B20. Si no está conectado, muestra `0CCC / 10 = 327.60 °C`.
- **Flag and Sensor Identifier**: 1 byte (**en la versión 1.3.1 son 2 bytes**). En binario, el bit 7 es el identificador de interrupción; los seis bits restantes identifican, en orden, las sondas de turbidez, oxígeno disuelto, ORP, ECK10, ECK1 y pH. Ejemplo: `101001` significa que hay tres sondas conectadas: turbidez, ORP y pH.
- **Datos de sensores** (2 bytes cada uno), según el ejemplo:
  - turbidity: `0x09CE / 10 = 251`
  - ORP: `0x0002 = 2`
  - pH: `0x02DE / 100 = 7.34`
  - pH_temp: `0x0111 / 10 = 27.3`

**[Nota StormCIP]** La tabla no incluye temperatura para el oxígeno disuelto, pero el `changelog.txt` dice que la v1.2 agregó temperatura a pH, DO y EC. Por eso el decoder resuelve el caso del DO validando el largo del payload. La tabla tampoco indica los divisores de ECK10_temp y ECK1_temp; se asume /10, igual que PH_temp.

---

## 2.3 Uplink FPort=3, Datalog

**[Nota StormCIP]** Según `changelog.txt`, el firmware v1.3.3 eliminó la función de datalog.

### 2.3.1 Cómo funciona

El equipo espera ACK en cada uplink. Si no hay red, marca los registros como sin ACK, los guarda y los reenvía (con 10 s de intervalo) cuando la red vuelve. Envía en modo CONFIRMED, pero no retransmite si no recibe ACK: solo marca el mensaje como NONE-ACK y lo reenvía cuando detecta que hay conexión de nuevo.

### 2.3.2 Habilitar el datalog

Requiere `SYNCMOD=1` (por defecto; sincroniza la hora con el comando MAC DeviceTimeReq) y `PNACKMD=1`. El servidor LoRaWAN debe soportar LoRaWAN v1.0.3 (MAC v1.0.3) o superior.

### 2.3.4 Payload del datalog (FPORT=3)

El equipo puede tener hasta 3 sondas opcionales. El datalog se ordena así:

| Tamaño (bytes) | 2 | 2 | 2 | 2 | 2 | 2 | 4 |
|---|---|---|---|---|---|---|---|
| Valor | turbidity (opcional) | dissolved oxygen (opcional) | ORP (opcional) | ECK10 (opcional) | ECK1 (opcional) | PH (opcional) | Unix TimeStamp |

Ejemplo: `048B013E03889367D39699`

- dissolved oxygen = `0x048B / 100 = 11.63`
- ECK1 = `0x013E = 318`
- PH = `0x0388 / 100 = 9.04`
- Unix time = `0x67D39699 = 1741919897` s = 2025-03-14 02:38:17

Flags del registro:
- **No ACK Message**: 1 indica que el registro viene de un uplink que no recibió ACK del servidor (función PNACKMD=1).
- **Poll Message Flag**: 1 indica que el mensaje es respuesta a un poll.

Cada registro ocupa **11 bytes**. El equipo envía tantos registros como permita el tamaño máximo de payload según el DR y la banda. Si no hay datos en el período consultado, envía 11 bytes en cero.

**[Nota StormCIP]** La tabla del manual lista 6 valores más el timestamp (16 bytes), pero el ejemplo y el texto indican 11 bytes por registro. La interpretación consistente con el ejemplo es: 3 valores (6 bytes) + 1 byte de flags + 4 bytes de timestamp. En el ejemplo, el byte 7 es `0x93` = `1001 0011`: bit 7 = sin ACK; bits 4, 1 y 0 = oxígeno disuelto, ECK1 y pH.
