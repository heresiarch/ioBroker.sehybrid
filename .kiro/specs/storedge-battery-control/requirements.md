# Requirements Document

## Introduction

This feature adds the SolarEdge StorEdge "Global StorEdge Control Block" registers onto the existing read-only SunSpec adapter, verified live against the user's SolarEdge inverter. Today the adapter is strictly read-only: the Modbus client exposes only FC03/FC04 reads, the state manager creates only `write=false` states from the SunSpec read map, and no state-change subscription exists.

The feature exposes all nine registers of the manufacturer-documented Global StorEdge Control Block, base address `0xE004` (mirrored at `0xF704`), as a new, always-present, always-active ioBroker channel named `StorEdgeControlBlock`. There is no master enable switch and no admin configuration of any kind for this feature: the channel and its nine states are created unconditionally at adapter startup, independent of any config value, and the adapter behaves identically regardless of any admin setting.

The nine registers are read on every `pollOnce` cycle, on the same schedule as the rest of the adapter's read model (inverter/meter/battery), and each state is updated with the live device value with `ack=true` — not merely echoing back the last write. The same nine states also accept user writes: on a non-acknowledged change, the adapter validates the new value against the register's documented range and, if valid, writes it to the device via FC06 (single uint16 registers) or FC16 (multi-word float32/uint32 registers) using the adapter's existing little-endian word-order encoding. An out-of-range value is rejected before any Modbus call is attempted: the adapter logs a validation error and retains the previously acknowledged value; the invalid value is never sent to the device and never acknowledged. A successful write is acknowledged with the written value; a failed write (disconnected, timeout, or Modbus exception) is logged and the previous acknowledged value is retained, following the same non-fatal failure pattern used elsewhere in the adapter.

There is no consumption-based logic, no computed discharge limit, no heartbeat renewal loop, no initial-configuration write sequence, no enable/disable lifecycle, no revert-on-disable, and no portal-profile prerequisite or warning. The user is responsible for deciding what to write to these registers and when — for example from their own ioBroker scripts. These nine `StorEdgeControlBlock` states are the only writable (`write=true`) states in the adapter; every other state remains read-only, matching the existing architecture.

Register encoding was verified live and cross-checked against the adapter's existing battery-block decoding: StorEdge control-block multi-word registers use little-endian word order (words swapped, bytes within each word big-endian), matching the adapter's existing `float32le`/`uint32le` convention in `sunspec-decode.ts`. This encoding is preserved unchanged for both reading and writing these nine registers.

## Glossary

- **Adapter**: The running `sehybrid` ioBroker adapter instance orchestrating polling and control.
- **Modbus_Client**: The Modbus TCP client wrapper (`modbus-client.ts`) that issues FC03/FC04 reads and, for this feature, FC06/FC16 writes.
- **State_Manager**: The ioBroker object/state manager (`state-manager.ts`) that creates channels and states.
- **Poll_Loop**: The existing repeating `pollOnce` cycle that reads device blocks on the configured interval.
- **StorEdgeControlBlock**: The always-present ioBroker channel, created unconditionally in `onReady`, containing the nine states defined below. Its base register address is `0xE004`, mirrored at `0xF704`.
- **Storage_Control_Mode**: Register `0xE004` (Uint16, range 0-4, 1 word), R/W. Selects the storage control mode.
- **Storage_AC_Charge_Policy**: Register `0xE005` (Uint16, range 0-3, 1 word), R/W. Selects the AC charge policy.
- **Storage_AC_Charge_Limit**: Register `0xE006` (Float32, range 0 to Max_Float, 2 words), R/W, units KWh or %. The AC charge limit.
- **Storage_Backup_Reserved_Setting**: Register `0xE008` (Float32, range 0-100, 2 words), R/W, units %. The backup reserved capacity setting.
- **Storage_Charge_Discharge_Default_Mode**: Register `0xE00A` (Uint16, range 0-7, 1 word), R/W. The default charge/discharge mode.
- **Remote_Control_Command_Timeout**: Register `0xE00B` (Uint32, range 0-86400, 2 words), R/W, units seconds. The remote control command timeout.
- **Remote_Control_Command_Mode**: Register `0xE00D` (Uint16, range 0-7, 1 word), R/W. The remote control command mode.
- **Remote_Control_Charge_Limit**: Register `0xE00E` (Float32, range 0 to Battery_Max_Power, 2 words), R/W, units W. The remote control charge power limit.
- **Remote_Control_Discharge_Limit**: Register `0xE010` (Float32, range 0 to Battery_Max_Power, 2 words), R/W, units W. The remote control discharge power limit.
- **StorEdgeControlBlock_Register**: Any one of the nine registers listed above (`Storage_Control_Mode`, `Storage_AC_Charge_Policy`, `Storage_AC_Charge_Limit`, `Storage_Backup_Reserved_Setting`, `Storage_Charge_Discharge_Default_Mode`, `Remote_Control_Command_Timeout`, `Remote_Control_Command_Mode`, `Remote_Control_Charge_Limit`, `Remote_Control_Discharge_Limit`).
- **Battery_Max_Power**: The upper bound of a StorEdgeControlBlock_Register's documented range where the manufacturer table specifies "Battery Max Power" instead of a fixed numeric maximum (applies to `Remote_Control_Charge_Limit` and `Remote_Control_Discharge_Limit`).
- **Max_Float**: The upper bound of a StorEdgeControlBlock_Register's documented range where the manufacturer table specifies "Max_Float" instead of a fixed numeric maximum (applies to `Storage_AC_Charge_Limit`).
- **Documented_Range**: The inclusive minimum and maximum value defined for a StorEdgeControlBlock_Register in the manufacturer's Power Control Open Protocol table, as listed in the Introduction.
- **Range_Validation**: The check performed before any write to a StorEdgeControlBlock_Register, confirming the candidate value falls within that register's Documented_Range.
- **Float32LE_Encoding**: The little-endian word-order float32 encoding (low word first, bytes within each word big-endian) already implemented as `float32le` in `sunspec-decode.ts`, used to decode and encode `Storage_AC_Charge_Limit`, `Storage_Backup_Reserved_Setting`, `Remote_Control_Charge_Limit`, and `Remote_Control_Discharge_Limit`.
- **Uint32LE_Encoding**: The little-endian word-order uint32 encoding (low word first) already implemented as `uint32le` in `sunspec-decode.ts`, used to decode and encode `Remote_Control_Command_Timeout`.

## Requirements

### Requirement 1: Modbus write function codes

**User Story:** As a developer, I want the Modbus client to support the write function codes the StorEdgeControlBlock requires, so that its registers can be written while the existing read paths are unchanged.

#### Acceptance Criteria

1. THE Modbus_Client SHALL expose a write-single-register operation using Modbus function code FC06 that writes one uint16 value to a given register address.
2. THE Modbus_Client SHALL expose a write-multiple-registers operation using Modbus function code FC16 that writes a word array to consecutive registers starting at a given address.
3. WHEN the Adapter writes Storage_Control_Mode, Storage_AC_Charge_Policy, Storage_Charge_Discharge_Default_Mode, or Remote_Control_Command_Mode, THE Modbus_Client SHALL use the FC06 write-single-register operation.
4. WHEN the Adapter writes Storage_AC_Charge_Limit, Storage_Backup_Reserved_Setting, Remote_Control_Charge_Limit, or Remote_Control_Discharge_Limit, THE Modbus_Client SHALL use the FC16 write-multiple-registers operation with two words in Float32LE_Encoding.
5. WHEN the Adapter writes Remote_Control_Command_Timeout, THE Modbus_Client SHALL use the FC16 write-multiple-registers operation with two words in Uint32LE_Encoding.
6. IF a write operation is requested while the Modbus_Client is not connected, THEN THE Modbus_Client SHALL reject the operation with a descriptive error.
7. THE Modbus_Client SHALL bound each write operation by the same default 10 second timeout applied to read operations.
8. THE Modbus_Client SHALL continue to expose the existing FC03 and FC04 read operations with unchanged behavior.

### Requirement 2: Restricted write surface

**User Story:** As a maintainer, I want the write surface strictly bounded, so that the adapter can only ever write the nine documented StorEdgeControlBlock registers using the two permitted function codes.

#### Acceptance Criteria

1. THE Modbus_Client SHALL restrict its write surface to the FC06 single-register and FC16 multiple-register operations defined in Requirement 1.
2. THE Modbus_Client SHALL NOT expose coil write operations (FC05 or FC15) or any other write function code.
3. THE Adapter SHALL issue write function codes only for the nine StorEdgeControlBlock_Register addresses `0xE004`, `0xE005`, `0xE006`, `0xE008`, `0xE00A`, `0xE00B`, `0xE00D`, `0xE00E`, and `0xE010`.
4. THE Adapter SHALL use FC06 for the uint16 StorEdgeControlBlock_Registers `0xE004`, `0xE005`, `0xE00A`, and `0xE00D`, and FC16 for the multi-word StorEdgeControlBlock_Registers `0xE006`, `0xE008`, `0xE00B`, `0xE00E`, and `0xE010`.

### Requirement 3: StorEdgeControlBlock register definitions

**User Story:** As a developer, I want the nine StorEdgeControlBlock registers defined verbatim from the manufacturer's table, so that the adapter's control surface matches the documented Global StorEdge Control Block exactly.

#### Acceptance Criteria

1. THE Adapter SHALL define Storage_Control_Mode at register `0xE004` as a 1-word uint16 register with Documented_Range 0 to 4, read via FC03/FC04 and written via FC06.
2. THE Adapter SHALL define Storage_AC_Charge_Policy at register `0xE005` as a 1-word uint16 register with Documented_Range 0 to 3, read via FC03/FC04 and written via FC06.
3. THE Adapter SHALL define Storage_AC_Charge_Limit at register `0xE006` as a 2-word float32 register in KWh or % with Documented_Range 0 to Max_Float, read via FC03/FC04 and written via FC16 with Float32LE_Encoding.
4. THE Adapter SHALL define Storage_Backup_Reserved_Setting at register `0xE008` as a 2-word float32 register in % with Documented_Range 0 to 100, read via FC03/FC04 and written via FC16 with Float32LE_Encoding.
5. THE Adapter SHALL define Storage_Charge_Discharge_Default_Mode at register `0xE00A` as a 1-word uint16 register with Documented_Range 0 to 7, read via FC03/FC04 and written via FC06.
6. THE Adapter SHALL define Remote_Control_Command_Timeout at register `0xE00B` as a 2-word uint32 register in seconds with Documented_Range 0 to 86400, read via FC03/FC04 and written via FC16 with Uint32LE_Encoding.
7. THE Adapter SHALL define Remote_Control_Command_Mode at register `0xE00D` as a 1-word uint16 register with Documented_Range 0 to 7, read via FC03/FC04 and written via FC06.
8. THE Adapter SHALL define Remote_Control_Charge_Limit at register `0xE00E` as a 2-word float32 register in W with Documented_Range 0 to Battery_Max_Power, read via FC03/FC04 and written via FC16 with Float32LE_Encoding.
9. THE Adapter SHALL define Remote_Control_Discharge_Limit at register `0xE010` as a 2-word float32 register in W with Documented_Range 0 to Battery_Max_Power, read via FC03/FC04 and written via FC16 with Float32LE_Encoding.
10. THE Adapter SHALL keep the StorEdgeControlBlock register definitions separate from the SunSpec read map used elsewhere by the Poll_Loop for inverter, meter, and battery blocks.

### Requirement 4: Little-endian multiword encoding

**User Story:** As a developer, I want float32 and uint32 StorEdgeControlBlock values encoded in little-endian word order matching the existing decoder, so that both reads and writes are interpreted correctly by this inverter.

#### Acceptance Criteria

1. WHEN the Adapter decodes a float32 StorEdgeControlBlock_Register from a Poll_Loop read, THE Adapter SHALL decode the two words using Float32LE_Encoding with the low word first and the bytes within each word in big-endian order.
2. WHEN the Adapter writes a float32 StorEdgeControlBlock_Register, THE Adapter SHALL encode the value using Float32LE_Encoding such that the encoding is the exact inverse of decoding that value with Float32LE_Encoding.
3. WHEN the Adapter decodes Remote_Control_Command_Timeout from a Poll_Loop read, THE Adapter SHALL decode the two words using Uint32LE_Encoding with the low word first.
4. WHEN the Adapter writes Remote_Control_Command_Timeout, THE Adapter SHALL encode the value using Uint32LE_Encoding such that the encoding is the exact inverse of decoding that value with Uint32LE_Encoding.
5. THE Adapter SHALL produce the two words `[0x4000, 0x459c]` when encoding the value 5000 using Float32LE_Encoding.

### Requirement 5: Poll loop read integration

**User Story:** As a user, I want the nine StorEdgeControlBlock registers read on the same schedule as the rest of the adapter, so that their states always reflect the live device values without a separate polling mechanism.

#### Acceptance Criteria

1. WHILE the Poll_Loop is running, THE Adapter SHALL read all nine StorEdgeControlBlock_Registers during each `pollOnce` cycle, on the same `pollInterval`/poll-once schedule used for the inverter, meter, and battery read blocks.
2. WHEN a `pollOnce` cycle reads a StorEdgeControlBlock_Register successfully, THE Adapter SHALL decode the register using its defined kind and word order and update the corresponding StorEdgeControlBlock state with the decoded value and `ack=true`.
3. THE Adapter SHALL update each StorEdgeControlBlock state from the live device value read during the Poll_Loop cycle rather than from the last value written by the Adapter.
4. IF a `pollOnce` read of a StorEdgeControlBlock_Register fails, THEN THE Adapter SHALL follow the existing Poll_Loop cycle-failure path and SHALL NOT terminate.

### Requirement 6: Range validation on write

**User Story:** As a user, I want out-of-range writes rejected before they reach the device, so that the inverter never receives a value outside its documented bounds.

#### Acceptance Criteria

1. WHEN a non-acknowledged change is received for a StorEdgeControlBlock state, THE Adapter SHALL perform Range_Validation on the candidate value against that register's Documented_Range before attempting any Modbus write.
2. IF the candidate value is outside the Documented_Range for its StorEdgeControlBlock_Register, THEN THE Adapter SHALL log a validation error and SHALL NOT forward the value to the Modbus_Client.
3. IF the candidate value is outside the Documented_Range for its StorEdgeControlBlock_Register, THEN THE Adapter SHALL retain the previously acknowledged value for that state and SHALL NOT acknowledge the invalid value.
4. WHEN the candidate value is within the Documented_Range for its StorEdgeControlBlock_Register, THE Adapter SHALL proceed to write the value via the Modbus_Client using the function code and encoding defined in Requirement 3.

### Requirement 7: Write dispatch and acknowledgement

**User Story:** As a user, I want my writes to the StorEdgeControlBlock states sent to the device and reliably acknowledged or rolled back, so that the displayed state always matches either my successful write or the last known-good value.

#### Acceptance Criteria

1. WHEN a non-acknowledged change is received for a StorEdgeControlBlock state and the candidate value passes Range_Validation, THE Adapter SHALL write the value to the device using the write path defined in Requirement 3 for that StorEdgeControlBlock_Register.
2. THE Adapter SHALL send every Range_Validation-passing write to the device; the Adapter SHALL NOT suppress a write because the candidate value equals the previously written or previously read value.
3. WHEN a write to a StorEdgeControlBlock_Register completes successfully, THE Adapter SHALL update the corresponding state with the written value and `ack=true`.
4. IF a write to a StorEdgeControlBlock_Register fails due to disconnection, timeout, or a Modbus exception, THEN THE Adapter SHALL log the failure, treat it as non-fatal, continue operation, and retain the previously acknowledged value for that state.
5. THE Adapter SHALL ignore state changes that are already acknowledged (`ack=true`) so that the Adapter's own Poll_Loop read-back updates do not trigger further writes.

### Requirement 8: Unconditional StorEdgeControlBlock channel creation

**User Story:** As a user, I want the StorEdgeControlBlock channel always present, so that I can read and write these registers without enabling any feature flag or configuring any setting.

#### Acceptance Criteria

1. THE Adapter SHALL create the StorEdgeControlBlock channel and its nine states unconditionally during `onReady`, independent of any configuration value.
2. THE Adapter SHALL create the StorEdgeControlBlock channel and its nine states idempotently, such that repeated adapter starts do not create duplicate objects.
3. THE Adapter SHALL behave identically with respect to the StorEdgeControlBlock regardless of any admin configuration setting; no configuration setting SHALL enable, disable, or alter this behavior.
4. THE State_Manager SHALL create the StorEdgeControlBlock channel and states outside the register-map-driven read model that produces the existing read-only SunSpec states.

### Requirement 9: Writable state surface

**User Story:** As a maintainer, I want the StorEdgeControlBlock states to be the only writable states in the adapter, so that the adapter's write surface stays explicit and bounded.

#### Acceptance Criteria

1. THE State_Manager SHALL create each of the nine StorEdgeControlBlock states with `read=true` and `write=true`.
2. THE State_Manager SHALL NOT create any other state in the adapter with `write=true`.
3. THE State_Manager SHALL create every state derived from the SunSpec read map (inverter, meter, battery) with `write=false`, unchanged from the existing architecture.
