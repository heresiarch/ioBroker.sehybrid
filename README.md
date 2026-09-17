![Logo](admin/sehybrid.png)

# ioBroker.sehybrid

[![NPM version](https://img.shields.io/npm/v/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sehybrid.svg)](https://www.npmjs.com/package/iobroker.sehybrid)
![Number of Installations](https://iobroker.live/badges/sehybrid-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/sehybrid-stable.svg)
[![NPM](https://nodei.co/npm/iobroker.sehybrid.png?downloads=true)](https://nodei.co/npm/iobroker.sehybrid/)

**Tests:** ![Test and Release](https://github.com/heresiarch/ioBroker.sehybrid/workflows/Test%20and%20Release/badge.svg)

> ⚠️ **Work in progress — use at your own risk.** This adapter is under active development. Interfaces and state
> trees may change between versions.

## SolarEdge hybrid inverter adapter for ioBroker

Monitors and controls SolarEdge hybrid inverters over **Modbus TCP** (SunSpec). It reads PV, battery and
operational data from the inverter and exposes it as ioBroker states. It can optionally take **Remote Control**
of the battery to limit discharge based on live house consumption (see [Battery storage control](#battery-storage-control)).

## Requirements

- A SolarEdge hybrid inverter with **Modbus TCP enabled** and reachable on your network.
- ioBroker with `js-controller` >= 6.0.11 and `admin` >= 7.0.23.

> Modbus TCP is usually enabled in the inverter's SetApp / installer menu. The default TCP port is **502** or **1502**.

## Installation

Install **sehybrid** from the ioBroker admin (Adapters tab), then create an instance.

## Configuration

Open the instance settings and configure the connection to your inverter:

| Setting | Default | Description |
|---------|---------|-------------|
| Host | *(empty)* | IP address or hostname of the inverter. Polling does not start until this is set. |
| Port | `502` or `1502` | Modbus TCP port of the inverter. |
| Unit ID | `1` | Modbus unit / slave ID of the inverter. |
| Poll interval | `30` | How often (in seconds) the adapter reads data from the inverter. |

The settings page includes a **Test connection** button that verifies the adapter can reach the inverter and
reads its manufacturer and model before you save.

Additional settings for battery control are described in [Battery storage control](#battery-storage-control).

## States

The adapter organizes the values it reads into channels:

- **info.connection** — `true` while the adapter is successfully polling the inverter, `false` otherwise.
- **Inverter** — power, energy, AC/DC measurements and status from the inverter.
- **Meter** — data from connected SunSpec meters (import/export, power, energy).
- **Battery** — state of charge, power, temperature and status for connected batteries.
- **Control** — writable StorEdge control states, created only when battery control is enabled (see below).

The exact list of states depends on your inverter model and the meters/batteries attached to it.

## Battery storage control

By default the adapter is **read-only**: it only reads values and never writes to the inverter. You can
optionally enable **battery storage control**, which puts the inverter into SolarEdge's **Remote Control**
storage mode and dynamically limits how much the battery is allowed to discharge, based on your live house
and wallbox (EV charger) consumption.

The typical use case: **don't let the home battery power your EV charger.** While a car is charging you usually
want it to draw from PV/grid, not drain the house battery. This adapter continuously sets the battery's
discharge limit to `house consumption − wallbox consumption`, so the battery still covers the rest of the
house but leaves the wallbox load to the grid/PV.

### ⚠️ Required inverter prerequisite (read first)

Before enabling control you **must disable the StorEdge storage profile** in the SolarEdge monitoring portal /
SetApp (Admin → Energy Manager → Storage Profile). If you skip this, the inverter's own cloud profile fights
the Modbus commands and reverts Remote Control back to *Maximize Self Consumption* after about **10 seconds**,
so control will not work reliably. This is a manual, one-time step on the inverter side; the adapter cannot do
it for you. The admin settings page shows this warning next to the enable switch.

This mirrors the community-documented fix for the "reverts after ~10 s" behavior
(see [binsentsu/home-assistant-solaredge-modbus #130](https://github.com/binsentsu/home-assistant-solaredge-modbus/issues/130)).

### How it works

The adapter follows SolarEdge's documented Remote Control procedure, which separates a one-time
**initial configuration** from a repeated **dynamic command** loop.

**When you enable control (once),** the adapter writes, in order:

1. `0xE000` Export Configuration = `0` (export control conflicts with Remote Control and is disabled).
2. `0xE004` Storage Control Mode = `4` (Remote Control).
3. `0xE00A` Storage Charge/Discharge **Default Mode** = your configured **fallback mode** — the mode the
   inverter falls back to on its own if the adapter stops talking to it (SolarEdge recommends `1`, Charge excess PV).
4. `0xE00D` Remote Control Command Mode = `4` (discharge up to the limit).
5. `0xE00B` Remote Control Command Timeout = your configured **command timeout** (seconds).
6. `0xE010` Remote Control Discharge Limit = the initial computed limit.

**On every poll cycle while control is active (the heartbeat),** the adapter:

1. **Renews** `0xE00B` (the command timeout) — this is SolarEdge's intended keep-alive.
2. Re-asserts `0xE00D = 4`.
3. Recomputes the discharge limit as `min( max(house − wallbox, 0), maxDischargeLimit )` in watts:
   - a **negative** result (wallbox draws more than the whole house) clamps to **0** — no discharge,
   - the result is capped at your configured **max discharge limit**,
   - if either source value is **missing, non-numeric, or older** than the configured max age, the limit is
     forced to **0** as a safe default.
4. Writes the discharge limit to `0xE010` **only when it changed** (to avoid needless writes).

The heartbeat does **not** re-write the initial-config registers (`0xE000`/`0xE004`/`0xE00A`) each cycle —
only the command timeout, command mode and discharge limit are part of the dynamic loop, as SolarEdge intends.
Because the command timeout is renewed every cycle with a short value, it is the primary keep-alive: if the
adapter stops (crash/restart), the inverter safely falls back to your configured **default fallback mode**
(`0xE00A`) once the timeout lapses.

When you turn control **off**, the adapter writes your configured **default storage control mode** back to
`0xE004` and stops controlling. Control is never reverted on adapter shutdown/restart — the command timeout
fallback handles that case.

> **Float encoding note:** the StorEdge power-control registers use *Big Endian, word-swapped* float32
> (bytes big-endian, the two 16-bit words swapped — the low word first). This matches the "Big Endian Word
> swap" datatype in the standard ioBroker Modbus adapter and was verified live against the inverter.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable battery control | *off* | Master switch. When off, the adapter is strictly read-only. When on, it takes Remote Control (requires the portal prerequisite above). |
| Default Storage Control Mode | `1` (Maximize Self Consumption) | The Storage Control Mode written back when control is disabled: `0` Disabled, `1` Maximize Self Consumption, `2` Time of Use, `3` Backup Only, `4` Remote Control. |
| Default fallback mode | `1` (Charge excess PV) | The Storage Charge/Discharge Default Mode (`0xE00A`, range 0–7) the inverter falls back to if the adapter stops refreshing the command timeout. |
| Command timeout (s) | `120` | Remote Control command timeout (`0xE00B`), renewed every poll cycle as the keep-alive. Must be greater than the poll interval. |
| House consumption state | *(empty)* | Object ID of a state (watts) holding total house consumption. Use the browse button to pick it from the object tree. |
| Wallbox consumption state | *(empty)* | Object ID of a state (watts) holding wallbox / EV-charger consumption. |
| Max discharge limit (W) | `5000` | Upper bound for the computed discharge limit. Set this at or below your battery's max discharge power. |
| Source max age (s) | `120` | If a consumption source has not updated within this many seconds it is treated as invalid and the discharge limit is set to 0. |

The two consumption states are **foreign** ioBroker states — they can belong to any adapter (a meter adapter,
a wallbox adapter such as go-ePy/Wallbox/openWB, a script, etc.). Both must report **watts**.

### Expert control states

When control is enabled, an advanced `control` channel is created with the raw StorEdge control registers for
manual/expert use. These are writable and go through the same write path (they honor write-only-if-changed):

- `control.storageControlMode` — raw `0xE004` (0–4)
- `control.remoteControlCommandMode` — raw `0xE00D` (0–7)
- `control.remoteControlDischargeLimit` — raw `0xE010` (watts)
- `control.remoteControlCommandTimeout` — raw `0xE00B` (seconds, **read-only**; the adapter never writes it)
- `control.computedDischargeLimit` — read-only reflection of the currently computed limit
- `control.controlActive` — read-only status flag

### Example: disable battery discharge for the wallbox

1. On the inverter, disable the StorEdge storage profile in the SolarEdge portal / SetApp.
2. In the adapter settings, set **House consumption state** and **Wallbox consumption state** to your meter and
   wallbox power states, leave **Max discharge limit** at your battery's rating, and tick **Enable battery control**.
3. Save. From now on, whenever the wallbox draws power, the battery discharge limit is automatically reduced by
   that amount, so the EV charges from grid/PV instead of the battery, while the battery still covers the rest
   of the house.

> **Safety:** enabling control makes the adapter write to your inverter's battery-control registers. Start with
> a conservative **Max discharge limit** and verify behavior before relying on it. This adapter is a
> work-in-progress; use at your own risk.

## Troubleshooting

- **No data / `info.connection` stays `false`** — check that the Host is set correctly, Modbus TCP is enabled
  on the inverter, and port `502` or `1502` is reachable from your ioBroker host.
- **Connection errors in the log** — verify the Unit ID matches your inverter and that no other client is
  holding the single Modbus TCP connection the inverter allows.
- **Battery control reverts to Maximize Self Consumption after a few seconds** — you have not disabled the
  StorEdge storage profile in the SolarEdge monitoring portal / SetApp. See the prerequisite above.
- **Discharge limit sits at 0** — one of the consumption source states is missing, not a number, or older than
  the configured *Source max age*. Check that both states update regularly and report watts.

## Support

Please report issues at [GitHub Issues](https://github.com/heresiarch/ioBroker.sehybrid/issues).

Developers: see [README_dev.md](README_dev.md) for build, test and release instructions.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (René Meyer) Added consumption-based battery storage control (Remote Control) with an admin object-ID picker for the consumption states
* (René Meyer) Documented battery storage control setup and usage in the README
* (René Meyer) Aligned battery control with SolarEdge's documented Remote Control procedure: one-time initial config (0xE000/0xE004/0xE00A/0xE00D/0xE00B/0xE010) plus a per-cycle command-timeout keep-alive; added Default fallback mode and Command timeout settings

### 0.0.3 (2026-09-12)
* (René Meyer) Split documentation into user (README.md) and developer (README_dev.md) guides
* (René Meyer) Documented the alternate Modbus TCP port 1502
* (René Meyer) Stopped versioning generated build output

### 0.0.2 (2026-09-11)
* (René Meyer) initial release
