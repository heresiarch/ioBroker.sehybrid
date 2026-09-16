# Requirements Document

## Introduction

This feature adds consumption-based SolarEdge StorEdge battery discharge control onto the existing read-only SunSpec adapter, verified live against the user's SolarEdge inverter. Today the adapter is strictly read-only: the Modbus client exposes only FC03/FC04 reads, the state manager creates only `write=false` states from the SunSpec read map, and no state-change subscription exists.

The feature drives the StorEdge Remote Control discharge power limit from live household consumption. The adapter subscribes to two configurable foreign ioBroker states (total house consumption in watts and wallbox consumption in watts) and continuously computes a discharge limit as `min(max(house - wallbox, 0), maxDischargeLimit)`, writing that limit to Remote Control Discharge Limit register `0xE010`. A single master `controlEnabled` switch gates all control: when OFF the adapter is strictly read-only (no writes, no subscriptions, no heartbeat); when ON the adapter puts the inverter into Remote Control mode and re-asserts that mode every poll cycle as a keep-alive heartbeat.

Because the StorEdge inverter otherwise reverts Remote Control to Maximize Self Consumption after roughly ten seconds, the user must disable the StorEdge storage profile in the SolarEdge monitoring portal / SetApp before enabling control. This is a documented manual prerequisite surfaced as an admin UI warning; it is not enforced by code. With the portal profile disabled, Remote Control persists and the per-poll re-assert is sufficient.

Register encoding was verified live and cross-checked against the adapter's existing battery-block decoding: StorEdge control-block multi-word registers use little-endian word order (words swapped, bytes within each word big-endian), matching the adapter's existing `float32le`/`uint32le` convention in `sunspec-decode.ts`. Writes to the float32 discharge limit must use an encoder that is the exact inverse of `decodeRegisters('float32le')`.

New admin configuration is added to the custom React admin UI (not jsonConfig), the config type (`adapter-config.d.ts`), and `io-package.json` native defaults. Individual raw control registers remain exposed as expert/advanced writable states, separate from the normal user surface.

Scope is intentionally minimal: master enable, consumption-based discharge control with clamping and stale-input safety, the per-poll heartbeat, revert-to-default on disable only, the expert raw states, and the portal prerequisite warning. There is no separate control timer and no shutdown/unload revert.

## Glossary

- **Adapter**: The running `sehybrid` ioBroker adapter instance orchestrating polling and control.
- **Modbus_Client**: The Modbus TCP client wrapper (`modbus-client.ts`) that today issues only FC03/FC04 reads.
- **State_Manager**: The ioBroker object/state manager (`state-manager.ts`) that creates channels and states.
- **Config_Validator**: The pure configuration validation module (`config-validation.ts`).
- **Poll_Loop**: The existing repeating `pollOnce` cycle that reads device blocks on the configured interval.
- **Control_Enabled**: The master admin boolean setting (`controlEnabled`, default false) that gates all control behavior.
- **Control_Active**: The state in which Control_Enabled is true and control is running (subscriptions, heartbeat, and writes are in effect).
- **Read_Only_Mode**: The state in which Control_Enabled is false; the Adapter performs no register writes, no foreign-state subscriptions, and no heartbeat.
- **Storage_Control_Mode**: StorEdge register `0xE004` (uint16, range 0-4) selecting the storage control mode. Values: 0 Disabled, 1 Maximize Self Consumption, 2 Time of Use / Profile programming, 3 Backup Only, 4 Remote Control.
- **Storage_Default_Mode_Register**: StorEdge register `0xE00A` (uint16, range 0-7), Storage Charge/Discharge Default Mode. Never written by the Adapter.
- **Remote_Control_Command_Timeout**: StorEdge register `0xE00B` (uint32 seconds, range 0-86400). Never written by the Adapter; readable only.
- **Remote_Control_Command_Mode**: StorEdge register `0xE00D` (uint16, range 0-7) selecting the remote control command mode. Value 4 = discharge up to the explicit discharge limit.
- **Remote_Control_Charge_Limit**: StorEdge register `0xE00E` (float32, 2 registers, watts). Expert-only, optional.
- **Remote_Control_Discharge_Limit**: StorEdge register `0xE010` (float32, 2 registers, watts, range 0 to battery max power) setting the remote control discharge power limit.
- **House_Consumption_Source**: The configurable foreign ioBroker state id (`houseConsumptionStateId`) providing total house consumption in watts.
- **Wallbox_Consumption_Source**: The configurable foreign ioBroker state id (`wallboxConsumptionStateId`) providing wallbox consumption in watts.
- **Computed_Discharge_Limit**: The discharge limit derived from the two sources as `min(max(house - wallbox, 0), Max_Discharge_Limit)`, in watts.
- **Max_Discharge_Limit**: The admin setting (`maxDischargeLimit`, default 5000 W) that upper-bounds the Computed_Discharge_Limit.
- **Source_Max_Age_Seconds**: The admin setting (`sourceMaxAgeSeconds`, default 120) that bounds how old a consumption source value may be before it is treated as invalid.
- **Default_Storage_Control_Mode**: The admin setting (`defaultStorageControlMode`, integer 0..4, default 1 = Maximize Self Consumption) written to `0xE004` when control is disabled.
- **Heartbeat**: The per-poll re-assert of `0xE004`=4 and `0xE00D`=4 plus the refresh of `0xE010` that keeps Remote Control active.
- **Float32LE_Encoding**: The little-endian word-order float32 encoding (low word first, bytes within each word big-endian) that is the exact inverse of `decodeRegisters(..., 'float32le')` in `sunspec-decode.ts`.
- **Expert_Control_State**: An individual raw control state exposed for advanced use, grouped/marked as expert/advanced, distinct from the normal user surface.
- **StorEdge_Portal_Profile**: The StorEdge storage profile configured in the SolarEdge monitoring portal / SetApp.

## Requirements

### Requirement 1: Master control enable and read-only guarantee

**User Story:** As a user, I want a single master switch that gates all control, so that I can run the adapter strictly read-only or turn on active control deliberately.

#### Acceptance Criteria

1. THE Adapter SHALL provide a Control_Enabled master setting that defaults to false.
2. WHILE Control_Enabled is false, THE Adapter SHALL NOT issue any Modbus register write.
3. WHILE Control_Enabled is false, THE Adapter SHALL NOT subscribe to House_Consumption_Source or Wallbox_Consumption_Source.
4. WHILE Control_Enabled is false, THE Adapter SHALL NOT perform the Heartbeat during any Poll_Loop cycle.
5. WHILE Control_Enabled is false, THE Adapter SHALL continue to perform its existing FC03/FC04 read polling unchanged.
6. WHERE Control_Enabled is true, THE Adapter SHALL enter Control_Active and perform control writes, source subscriptions, and the Heartbeat as defined in the remaining requirements.

### Requirement 2: Modbus write function codes

**User Story:** As a developer, I want the Modbus client to support the write function codes StorEdge control requires, so that control registers can be set while the existing read paths are unchanged.

#### Acceptance Criteria

1. THE Modbus_Client SHALL expose a write-single-register operation using Modbus function code FC06 that writes one uint16 value to a given register address.
2. THE Modbus_Client SHALL expose a write-multiple-registers operation using Modbus function code FC16 that writes a word array to consecutive registers starting at a given address.
3. WHEN the Adapter writes Storage_Control_Mode or Remote_Control_Command_Mode, THE Modbus_Client SHALL use the FC06 write-single-register operation.
4. WHEN the Adapter writes Remote_Control_Discharge_Limit, THE Modbus_Client SHALL use the FC16 write-multiple-registers operation with two words.
5. IF a write operation is requested while the Modbus_Client is not connected, THEN THE Modbus_Client SHALL reject the operation with a descriptive error.
6. THE Modbus_Client SHALL bound each write operation by the same default 10 second timeout applied to read operations.
7. THE Modbus_Client SHALL continue to expose the existing FC03 and FC04 read operations with unchanged behavior.

### Requirement 3: Revised read-only invariant

**User Story:** As a maintainer, I want the previously strict read-only invariant revised, so that documentation and property tests reflect the controlled introduction of writes.

#### Acceptance Criteria

1. THE Modbus_Client SHALL restrict its write surface to the FC06 single-register and FC16 multiple-register operations defined in Requirement 2.
2. THE Modbus_Client SHALL NOT expose coil write operations (FC05 or FC15) or any other write function code.
3. THE Adapter SHALL issue write function codes only for the StorEdge control registers `0xE004`, `0xE00D`, `0xE010`, and `0xE00E`.

### Requirement 4: StorEdge control-register definitions

**User Story:** As a developer, I want the StorEdge control registers defined outside the existing SunSpec read map, so that control registers in the `0xExxx` range are managed distinctly from polled SunSpec values.

#### Acceptance Criteria

1. THE Adapter SHALL define Storage_Control_Mode at register `0xE004` as a uint16 control register with value range 0 to 4.
2. THE Adapter SHALL define Storage_Default_Mode_Register at register `0xE00A` as a uint16 control register with value range 0 to 7.
3. THE Adapter SHALL define Remote_Control_Command_Timeout at register `0xE00B` as a uint32 seconds control register with value range 0 to 86400.
4. THE Adapter SHALL define Remote_Control_Command_Mode at register `0xE00D` as a uint16 control register with value range 0 to 7.
5. THE Adapter SHALL define Remote_Control_Charge_Limit at register `0xE00E` as a float32 control register spanning 2 registers in watts.
6. THE Adapter SHALL define Remote_Control_Discharge_Limit at register `0xE010` as a float32 control register spanning 2 registers in watts.
7. THE Adapter SHALL keep the StorEdge control-register definitions separate from the SunSpec read map used by the Poll_Loop.

### Requirement 5: Little-endian float32 write encoding

**User Story:** As a developer, I want float32 control values encoded in little-endian word order matching the existing decoder, so that written values are interpreted correctly by this inverter.

#### Acceptance Criteria

1. WHEN the Adapter writes a float32 control register, THE Adapter SHALL encode the value using Float32LE_Encoding with the low word first and the bytes within each word in big-endian order.
2. THE Adapter SHALL encode float32 control values such that the encoder is the exact inverse of `decodeRegisters(..., 'float32le')`; for any finite float32 value, decoding the encoded words as `float32le` SHALL reproduce that value bit-exact after float32 rounding.
3. THE Adapter SHALL produce the two words `[0x4000, 0x459c]` when encoding the value 5000 watts.
4. WHEN the Adapter writes Remote_Control_Discharge_Limit `0xE010`, THE Adapter SHALL send the Float32LE_Encoding words via FC16.

### Requirement 6: Consumption source subscription and validity

**User Story:** As a user, I want the adapter to track my house and wallbox consumption, so that discharge follows real household load.

#### Acceptance Criteria

1. WHERE Control_Enabled is true, THE Adapter SHALL subscribe to House_Consumption_Source and Wallbox_Consumption_Source using their configured foreign state ids.
2. THE Adapter SHALL treat a consumption source value as invalid IF the source value is missing.
3. THE Adapter SHALL treat a consumption source value as invalid IF the source value is non-numeric.
4. THE Adapter SHALL treat a consumption source value as invalid IF the source value is older than Source_Max_Age_Seconds.

### Requirement 7: Computed discharge limit and safety clamping

**User Story:** As a user, I want the discharge limit derived from consumption with safe bounds, so that the battery discharges only up to real load and never on bad data.

#### Acceptance Criteria

1. WHILE Control_Active and both consumption sources are valid, THE Adapter SHALL set Computed_Discharge_Limit to `min(max(House_Consumption_Source - Wallbox_Consumption_Source, 0), Max_Discharge_Limit)`.
2. WHILE the difference of House_Consumption_Source minus Wallbox_Consumption_Source is negative, THE Adapter SHALL clamp Computed_Discharge_Limit to 0.
3. WHILE the difference of House_Consumption_Source minus Wallbox_Consumption_Source exceeds Max_Discharge_Limit, THE Adapter SHALL clamp Computed_Discharge_Limit to Max_Discharge_Limit.
4. IF either House_Consumption_Source or Wallbox_Consumption_Source is invalid, THEN THE Adapter SHALL set Computed_Discharge_Limit to 0.

### Requirement 8: Write-only-if-changed discharge limit

**User Story:** As a user, I want the discharge limit written only when it changes, so that the inverter is not written to unnecessarily.

#### Acceptance Criteria

1. WHEN the Computed_Discharge_Limit differs from the last value written to `0xE010`, THE Adapter SHALL write Computed_Discharge_Limit to `0xE010` using FC16 with Float32LE_Encoding.
2. WHILE the Computed_Discharge_Limit equals the last value written to `0xE010`, THE Adapter SHALL NOT write `0xE010`.
3. WHEN the Adapter writes Computed_Discharge_Limit to `0xE010`, THE Adapter SHALL record the written value as the new last-written value.

### Requirement 9: Enable sequencing

**User Story:** As a user, I want the inverter placed into Remote Control discharge when I enable control, so that consumption-based discharge takes effect.

#### Acceptance Criteria

1. WHEN Control_Enabled transitions to true, THE Adapter SHALL write value 4 to Storage_Control_Mode `0xE004` using FC06.
2. WHEN Control_Enabled transitions to true, THE Adapter SHALL write value 4 to Remote_Control_Command_Mode `0xE00D` using FC06.
3. WHEN Control_Enabled transitions to true, THE Adapter SHALL write Computed_Discharge_Limit to Remote_Control_Discharge_Limit `0xE010` using FC16 with Float32LE_Encoding.

### Requirement 10: Command timeout register never written

**User Story:** As a maintainer, I want the command timeout register left untouched, so that the adapter avoids the inverter's timeout-reset and intermittent write-exception behavior.

#### Acceptance Criteria

1. THE Adapter SHALL NOT write Remote_Control_Command_Timeout `0xE00B` under any condition.
2. WHERE the Adapter accesses Remote_Control_Command_Timeout `0xE00B`, THE Adapter SHALL read the register only.

### Requirement 11: Heartbeat via the existing poll loop

**User Story:** As a user, I want the remote command kept alive by the existing poll cycle, so that no separate timer is introduced and Remote Control does not revert while active.

#### Acceptance Criteria

1. WHILE Control_Active, THE Adapter SHALL write value 4 to Storage_Control_Mode `0xE004` during each Poll_Loop cycle regardless of its last written value.
2. WHILE Control_Active, THE Adapter SHALL write value 4 to Remote_Control_Command_Mode `0xE00D` during each Poll_Loop cycle regardless of its last written value.
3. WHILE Control_Active, THE Adapter SHALL refresh `0xE010` to the current Computed_Discharge_Limit during each Poll_Loop cycle subject to the write-only-if-changed rule in Requirement 8.
4. THE Adapter SHALL perform the Heartbeat within the existing Poll_Loop cycle rather than using a separate control timer.
5. IF a Heartbeat write fails, THEN THE Adapter SHALL follow the existing Poll_Loop cycle-failure path and SHALL NOT terminate.

### Requirement 12: Revert to default on disable

**User Story:** As a user, I want disabling control to return the inverter to my configured default mode, so that the battery resumes normal operation.

#### Acceptance Criteria

1. WHEN Control_Enabled transitions to false, THE Adapter SHALL write Default_Storage_Control_Mode to Storage_Control_Mode `0xE004` using FC06.
2. WHEN Control_Enabled transitions to false, THE Adapter SHALL stop subscribing to House_Consumption_Source and Wallbox_Consumption_Source.
3. WHEN Control_Enabled transitions to false, THE Adapter SHALL stop performing the Heartbeat during subsequent Poll_Loop cycles.
4. THE Adapter SHALL NOT write Storage_Default_Mode_Register `0xE00A` under any condition.
5. THE Adapter SHALL NOT perform a control revert during shutdown or unload.

### Requirement 13: Expert raw control states

**User Story:** As an advanced user, I want direct access to the raw control registers, so that I can inspect and override them when needed.

#### Acceptance Criteria

1. WHERE Control_Enabled is true, THE State_Manager SHALL create Expert_Control_States for Storage_Control_Mode `0xE004`, Remote_Control_Command_Mode `0xE00D`, and Remote_Control_Discharge_Limit `0xE010` as writable states with `read=true` and `write=true`.
2. WHERE Control_Enabled is true, THE State_Manager SHALL create a read-only Expert_Control_State for Remote_Control_Command_Timeout `0xE00B` with `read=true` and `write=false`.
3. THE State_Manager SHALL group or mark the Expert_Control_States as expert or advanced, distinct from the normal user surface.
4. WHEN a user-originated change is received for a writable Expert_Control_State, THE Adapter SHALL write the new value using the same write path, honoring the write-only-if-changed rule for `0xE010`.
5. THE Adapter SHALL ignore acknowledged state changes so that adapter-originated writes do not trigger further writes.
6. THE State_Manager SHALL create the Expert_Control_States outside the register-map-driven read model that produces the existing read-only SunSpec states.

### Requirement 14: Non-fatal write failures

**User Story:** As a user, I want write failures to be tolerated, so that a transient Modbus error does not crash the adapter or corrupt state.

#### Acceptance Criteria

1. IF a control-register write fails, THEN THE Adapter SHALL log the failure and retain the previously acknowledged state value.
2. IF a write fails with a Modbus exception, THEN THE Adapter SHALL treat the failure as non-fatal and continue operation.
3. WHEN a control-register write completes successfully, THE Adapter SHALL update the corresponding state with `ack=true`.

### Requirement 15: StorEdge portal prerequisite

**User Story:** As a user, I want to be warned about the required portal setting, so that Remote Control does not revert after ten seconds.

#### Acceptance Criteria

1. THE Adapter SHALL document that the user must disable the StorEdge_Portal_Profile in the SolarEdge monitoring portal or SetApp before enabling control.
2. THE React admin UI SHALL display a warning describing the StorEdge_Portal_Profile prerequisite near the Control_Enabled setting.
3. THE Adapter SHALL NOT enforce the StorEdge_Portal_Profile prerequisite in code and SHALL treat it as a manual user step.

### Requirement 16: Admin configuration

**User Story:** As a user, I want to configure control in the admin UI, so that control behaves according to my system.

#### Acceptance Criteria

1. THE Adapter SHALL add Control_Enabled, Default_Storage_Control_Mode, House_Consumption_Source, Wallbox_Consumption_Source, Max_Discharge_Limit, and Source_Max_Age_Seconds to the configuration type, the `io-package.json` native defaults, and the React admin UI.
2. THE Adapter SHALL default Control_Enabled to false, Default_Storage_Control_Mode to 1, Max_Discharge_Limit to 5000 watts, and Source_Max_Age_Seconds to 120 seconds.
3. THE React admin UI SHALL present Default_Storage_Control_Mode as a selection with exactly five options: 0 Disabled; 1 Maximize Self Consumption; 2 Time of Use / Profile programming; 3 Backup Only; 4 Remote Control.
4. THE React admin UI SHALL provide foreign-state-id inputs for House_Consumption_Source and Wallbox_Consumption_Source.
5. THE React admin UI SHALL provide translated (i18n) labels for the added configuration fields.

### Requirement 17: Control configuration validation

**User Story:** As a user, I want the control configuration validated, so that invalid settings are rejected before control starts.

#### Acceptance Criteria

1. THE Config_Validator SHALL accept Default_Storage_Control_Mode only when it is an integer in the range 0 to 4 inclusive.
2. THE Config_Validator SHALL accept Max_Discharge_Limit only when it is a positive number.
3. THE Config_Validator SHALL accept Source_Max_Age_Seconds only when it is a positive integer.
4. WHERE Control_Enabled is true, THE Config_Validator SHALL require House_Consumption_Source and Wallbox_Consumption_Source to be non-empty strings.
5. IF any control configuration value violates a bound, THEN THE Config_Validator SHALL report an error naming the offending field.
