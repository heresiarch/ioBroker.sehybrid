# Bugfix Requirements Document

## Introduction

On an inverter that has no meter (and/or no battery), the polling cycle fails every tick even though the inverter block is read successfully. During meter detection, `detectMeters()` in `src/lib/sunspec-reader.ts` probes meter slots 1..3 by reading the DID presence register (slot 1 = `METER_DID_ADDRESS` = 40188) with `client.readHoldingRegisters(addr, 1)`. This read has no error handling. A meterless device rejects the read with Modbus exception 2 (Illegal data address), which the Modbus client wraps into a thrown `Error`. That error propagates out of `detectMeters()` through `pollOnce()` in `src/main.ts` into the cycle-level catch, which sets `info.connection` to false, logs `Polling cycle failed: ...` at error level, closes the socket, and increments `consecutiveFailures` — on every cycle.

The result, reported in GitHub issue #43 (adapter v1.1.2), is that a SolarEdge inverter without a meter reads its inverter block fine (acPower, acEnergyWh, etc. update) but `info.connection` stays false and an error is logged every 30 seconds.

`detectBatteries()` in the same file already handles this correctly: it wraps the per-slot presence read in try/catch and, on a thrown read error, logs a debug message and treats the slot as absent (`continue`). The fix is to make meter detection tolerate a rejected/failed presence read the same way, so a legitimately meterless (or batteryless) inverter still produces a healthy cycle with `info.connection` true.

The per-instance configuration toggle to disable meter/battery polling, mentioned as an alternative in the issue, is out of scope for this bugfix; the core defect is the unhandled exception during meter detection.

## Bug Analysis

### Current Behavior (Defect)

When an inverter does not have a meter in a probed slot, the device rejects the presence read and the unhandled error fails the whole cycle.

1.1 WHEN `detectMeters()` reads a meter DID presence register (e.g. slot 1 at address 40188) on an inverter without a meter in that slot AND the device rejects the read with a Modbus exception (e.g. exception 2, Illegal data address) THEN the thrown error is not caught in `detectMeters()` and propagates out of the function
1.2 WHEN that read error propagates into the cycle-level catch in `pollOnce()` THEN the system sets `info.connection` to false, logs `Polling cycle failed: ...` at error level, closes the socket, and increments `consecutiveFailures`
1.3 WHEN the inverter block was read successfully in the same cycle but a meter presence read was rejected THEN the system still treats the entire cycle as failed, discarding the successful inverter read from the connection status
1.4 WHEN polling continues on a meterless inverter THEN the system repeats the `Polling cycle failed` error log every polling interval (e.g. every 30s) and keeps `info.connection` false indefinitely

### Expected Behavior (Correct)

Meter detection should mirror `detectBatteries()`: a rejected/failed presence read means the slot is absent, not that the cycle failed.

2.1 WHEN `detectMeters()` reads a meter DID presence register and the device rejects the read with a thrown error THEN the system SHALL catch the error within `detectMeters()`, treat that meter slot as absent, and continue probing the remaining meter slots without re-throwing
2.2 WHEN a meter presence read is rejected and the slot is treated as absent THEN the system SHALL NOT fail the polling cycle and SHALL allow the cycle to complete based on the inverter read
2.3 WHEN the inverter block is read successfully and no meter (or battery) slot is present THEN the system SHALL set `info.connection` to true for that cycle
2.4 WHEN a meter presence read is rejected and the slot is treated as absent THEN the system SHALL log the occurrence once per occurrence at debug level (consistent with the existing meter/battery "absent" debug logs) and SHALL NOT log it as a repeated error every cycle
2.5 WHEN a cycle completes with a successfully read inverter block and no present meter/battery slots THEN the system SHALL reset `consecutiveFailures` to 0 and SHALL NOT close the socket as a failure response

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a meter slot presence read succeeds and returns a recognized meter model DID (`METER_MODEL_IDS`, 201..204) THEN the system SHALL CONTINUE TO detect that meter, create its channel, and read and write its values as before
3.2 WHEN a meter slot presence read succeeds but returns a value that is not a recognized meter model DID THEN the system SHALL CONTINUE TO treat that slot as absent and log it at debug level as it does today
3.3 WHEN a battery slot presence read is rejected or returns an absent sentinel THEN the system SHALL CONTINUE TO treat that battery slot as absent and log it at debug level (existing `detectBatteries()` behavior)
3.4 WHEN a genuine connection or inverter-read failure occurs (e.g. the inverter block read itself fails, a timeout, or a connection error) THEN the system SHALL CONTINUE TO set `info.connection` to false, log `Polling cycle failed: ...`, close the socket, increment `consecutiveFailures`, and escalate after `MAX_CONSECUTIVE_FAILURES`
3.5 WHEN an inverter has a meter and/or battery present THEN the system SHALL CONTINUE TO detect, read, and write all present meter and battery slots unchanged
3.6 WHEN the polling cycle runs THEN the system SHALL CONTINUE TO respect the overlap guard, poll interval scheduling, and restored-connection logging as before

## Bug Condition and Properties

### Bug Condition

```pascal
FUNCTION isBugCondition(X)
  INPUT: X describing one polling cycle against an inverter
  OUTPUT: boolean

  // The inverter block reads successfully, but probing a meter slot's
  // presence register throws (device rejects it, e.g. Modbus exception 2).
  RETURN inverterReadSucceeds(X)
     AND existsMeterSlot(s) SUCH THAT meterPresenceReadThrows(X, s)
END FUNCTION
```

### Fix Checking

```pascal
// Property: a rejected meter presence read is treated as an absent slot,
// not as a cycle failure.
FOR ALL X WHERE isBugCondition(X) DO
  result ← pollOnce'(X)
  ASSERT cycleCompletes(result)
     AND infoConnection(result) = true
     AND NOT errorLogged("Polling cycle failed", result)
     AND slotLoggedAbsentAtDebug(result)
     AND consecutiveFailures(result) = 0
END FOR
```

Where:
- **F** = `pollOnce` / `detectMeters` as they exist before the fix (no try/catch around the meter presence read).
- **F'** = `pollOnce` / `detectMeters` after the fix (per-slot try/catch that treats a rejected read as absent).

### Preservation Checking

```pascal
// Property: for all cycles that do NOT hit the bug condition, the fixed
// code behaves identically to the original.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

This covers: present meters, unrecognized-but-readable DID values, present/absent batteries, and genuine inverter/connection failures — all of which must behave exactly as before.
