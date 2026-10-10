//-----------------------------
// Configuration
//-----------------------------

// KEBA wallbox states
const KEBA_CONNECTION_STR = "kecontact.0.info.connection";
const KEBA_PVCHARGING_STR = "kecontact.0.automatic.photovoltaics";
const KEBA_PLUG_STR = "kecontact.0.plug";
const KEBA_STATE_STR = "kecontact.0.state";

// SolarEdge StorEdge control registers (sehybrid adapter instance sehybrid.0).
// Writing a non-acked value to these states makes the adapter dispatch a Modbus
// write (FC06 for uint16, FC16 for float32le/uint32le) and ack on success.
const SE_CONTROL_MODE_STR = 'sehybrid.0.StorEdgeControlBlock.storageControlMode'/*storageControlMode*/;          // 0xE004 (uint16, 0..4)
const SE_COMMAND_MODE_STR = 'sehybrid.0.StorEdgeControlBlock.remoteControlCommandMode'/*remoteControlCommandMode*/; // 0xE00D (uint16, 0..7)
const SE_DISCHARGE_LIMIT_STR = 'sehybrid.0.StorEdgeControlBlock.remoteControlDischargeLimit'/*remoteControlDischargeLimit*/;    // 0xE010 (float32, W)
const SE_COMMAND_TIMEOUT_STR = 'sehybrid.0.StorEdgeControlBlock.remoteControlCommandTimeout'/*remoteControlCommandTimeout*/; // 0xE00B (uint32, s); set "" to disable, or adjust if your adapter names it differently

// SolarEdge control values
const SE_CONTROL_MODE_REMOTE = 4;            // Storage Control Mode: 4 = Remote Control (required for the discharge limit to take effect)
const SE_COMMAND_MODE_SELF_CONSUMPTION = 7;  // Remote Control Command Mode: 7 = Maximize Self Consumption (evcc "hold" pins this)
const SE_DISCHARGE_LIMIT_DEFAULT = 5000;     // W, restored on reset

// Watchdog (mirrors the evcc solaredge-hybrid template):
//  1. Inverter-side timeout written to SE_COMMAND_TIMEOUT_STR: the inverter leaves
//     Remote Control after SE_WATCHDOG_TIMEOUT_S without a command, surviving a full
//     ioBroker/script crash so the battery can never stay stuck blocked.
//  2. Script-side keepalive every SE_KEEPALIVE_MS re-asserts the hold and refreshes
//     the inverter timeout. SE_KEEPALIVE_MS must stay comfortably below
//     SE_WATCHDOG_TIMEOUT_S so a healthy script always refreshes in time.
const SE_WATCHDOG_TIMEOUT_S = 60;   // inverter self-revert timeout
const SE_KEEPALIVE_MS = 30 * 1000;  // script re-assert interval (< timeout)

// PV surplus check delay after plug lock / PV-charging off
const PV_CHECK_DELAY_MS = 3 * 60 * 1000;

const optionsDate = { dateStyle: 'medium' , timeZone: 'Europe/Berlin'};
const optionsTime = { timeZone: 'Europe/Berlin'};

const STATE =
{
  startup: {val: 0, name: "Startup"},
  not_ready: {val: 1, name: "Not Ready"},
  ready: {val: 2, name: "Ready"},
  charging: {val: 3, name: "Charging"},
  error: {val: 4, name: "Error"},
  interrupted: {val: 5, name: "Interrupted"}
};

const PLUG =
{
  unplugged: {val: 0, name: "Unplugged"},
  idle: {val: 3, name: "Idle"},
  plugged: {val: 5, name: "Plugged"},
  locked: {val: 7, name: "Locked"}
};

var timerID = null;
var blockingActive = false;
var watchdogID = null;

on({id: KEBA_PLUG_STR, change: "ne"}, async function (obj) {
  var value = obj.state.val;
  var oldValue = obj.oldState.val;

  let plugVal = "undefined";
  for (var prop in PLUG) {
    if (PLUG[prop].val == value) {
      plugVal = PLUG[prop].name;
      break;
    }
  }

  // wait 3 min, then check if surplus charging or normal
  if (value == 7 && oldValue != 7) {
    timerID = setTimeout(checkPV, PV_CHECK_DELAY_MS);
    setState(KEBA_PVCHARGING_STR, false);
  } else if (value <= 3) {
    if (timerID) {
      clearTimeout(timerID);
      timerID = null;
    }
    resetSEBatteryLimit();
  }
});

on({id: KEBA_STATE_STR, change: "ne"}, async function (obj) {
  var value = obj.state.val;
  var oldValue = obj.oldState.val;
  
  let stateVal = "undefined";
  for (var prop in STATE) {
    if (STATE[prop].val == value) {
      stateVal = STATE[prop].name;
      break;
    }
  }

  // reset BatMinHome when charging is completed
  if (value == 2 && oldValue == 3) {
    resetSEBatteryLimit();
  }
});

//-----------------------------
// pv surplus charging
//-----------------------------

async function checkPV() {
  let stateVal = getState(KEBA_STATE_STR).val;
  let pvCharging = getState(KEBA_PVCHARGING_STR).val;

  // do not use battery for charging
  if (stateVal == 3 && !pvCharging) {
    // Akku nicht nutzen, Wert ist Leistung die WB zieht
    disableSEBatteryDischarge();
  }

  timerID = null;
}

on({id: KEBA_PVCHARGING_STR, change: "any"}, async function (obj) {
  var value = obj.state.val;

  if (timerID) {
    clearTimeout(timerID);
    timerID = null;
  }

  if (value == false) {
    timerID = setTimeout(checkPV, PV_CHECK_DELAY_MS);
  } else {
    // reset auf default Wert sobald Verbaruch über Wert wird Akku genutzt, Settings WR  
    resetSEBatteryLimit();
  }
});

//-----------------------------
// SolarEdge battery control
//-----------------------------

async function writeInverterTimeout(seconds) {
  // Best-effort write of the inverter's own command timeout. Skipped silently if
  // the state id is empty or does not exist, so an unverified id can never throw.
  if (!SE_COMMAND_TIMEOUT_STR) {
    return;
  }
  try {
    if (await existsStateAsync(SE_COMMAND_TIMEOUT_STR)) {
      setState(SE_COMMAND_TIMEOUT_STR, seconds);
    }
  } catch (e) {
    // ignore: keepalive still protects us
  }
}

function startWatchdog() {
  if (watchdogID) {
    clearInterval(watchdogID);
  }
  watchdogID = setInterval(function () {
    if (blockingActive) {
      // Re-assert the hold and refresh the inverter timeout.
      setState(SE_CONTROL_MODE_STR, SE_CONTROL_MODE_REMOTE);
      setState(SE_COMMAND_MODE_STR, SE_COMMAND_MODE_SELF_CONSUMPTION);
      setState(SE_DISCHARGE_LIMIT_STR, 0);
      writeInverterTimeout(SE_WATCHDOG_TIMEOUT_S);
    }
  }, SE_KEEPALIVE_MS);
}

function stopWatchdog() {
  if (watchdogID) {
    clearInterval(watchdogID);
    watchdogID = null;
  }
}

async function disableSEBatteryDischarge() {
  // Put the inverter into Remote Control so the discharge limit is honored, then
  // force the discharge limit to 0 W (evcc "hold": DischargeLimit = 0).
  blockingActive = true;
  await writeInverterTimeout(SE_WATCHDOG_TIMEOUT_S); // arm inverter-side auto-revert
  setState(SE_CONTROL_MODE_STR, SE_CONTROL_MODE_REMOTE);
  setState(SE_COMMAND_MODE_STR, SE_COMMAND_MODE_SELF_CONSUMPTION); // pin command mode (evcc "hold")
  setState(SE_DISCHARGE_LIMIT_STR, 0);
  startWatchdog();
}

async function resetSEBatteryLimit() {
  // Restore the default discharge limit while remote control is active (evcc
  // "normal": DischargeLimit = rated/default). Only acts if we are in Remote
  // Control (value 4), i.e. a prior disableSEBatteryDischarge() is in effect.
  blockingActive = false;
  stopWatchdog();
  let limit = await getStateAsync(SE_DISCHARGE_LIMIT_STR);
  let cc = await getStateAsync(SE_CONTROL_MODE_STR);
  if (cc.val === SE_CONTROL_MODE_REMOTE) {
    if (limit.val != SE_DISCHARGE_LIMIT_DEFAULT) {
      setState(SE_DISCHARGE_LIMIT_STR, SE_DISCHARGE_LIMIT_DEFAULT);
    }
  }
}

// Clean up timers when the script is stopped/restarted.
onStop(function () {
  stopWatchdog();
}, 2000);
