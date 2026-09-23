"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var storedge_control_map_exports = {};
__export(storedge_control_map_exports, {
  BATTERY_MAX_POWER_W: () => BATTERY_MAX_POWER_W,
  REMOTE_CONTROL_CHARGE_LIMIT: () => REMOTE_CONTROL_CHARGE_LIMIT,
  REMOTE_CONTROL_COMMAND_MODE: () => REMOTE_CONTROL_COMMAND_MODE,
  REMOTE_CONTROL_COMMAND_TIMEOUT: () => REMOTE_CONTROL_COMMAND_TIMEOUT,
  REMOTE_CONTROL_DISCHARGE_LIMIT: () => REMOTE_CONTROL_DISCHARGE_LIMIT,
  STORAGE_AC_CHARGE_LIMIT: () => STORAGE_AC_CHARGE_LIMIT,
  STORAGE_AC_CHARGE_POLICY: () => STORAGE_AC_CHARGE_POLICY,
  STORAGE_BACKUP_RESERVED_SETTING: () => STORAGE_BACKUP_RESERVED_SETTING,
  STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE: () => STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE,
  STORAGE_CONTROL_MODE: () => STORAGE_CONTROL_MODE,
  STOREDGE_CONTROL_REGISTERS: () => STOREDGE_CONTROL_REGISTERS,
  findStorEdgeControlDef: () => findStorEdgeControlDef
});
module.exports = __toCommonJS(storedge_control_map_exports);
const BATTERY_MAX_POWER_W = 1e4;
const STORAGE_CONTROL_MODE = {
  name: "storageControlMode",
  address: 57348,
  kind: "uint16",
  length: 1,
  iobType: "number",
  min: 0,
  max: 4,
  fc: "FC06"
};
const STORAGE_AC_CHARGE_POLICY = {
  name: "storageAcChargePolicy",
  address: 57349,
  kind: "uint16",
  length: 1,
  iobType: "number",
  min: 0,
  max: 3,
  fc: "FC06"
};
const STORAGE_AC_CHARGE_LIMIT = {
  name: "storageAcChargeLimit",
  address: 57350,
  kind: "float32",
  length: 2,
  wordOrder: "le",
  iobType: "number",
  unit: "kWh",
  min: 0,
  max: Number.MAX_VALUE,
  fc: "FC16"
};
const STORAGE_BACKUP_RESERVED_SETTING = {
  name: "storageBackupReservedSetting",
  address: 57352,
  kind: "float32",
  length: 2,
  wordOrder: "le",
  iobType: "number",
  unit: "%",
  min: 0,
  max: 100,
  fc: "FC16"
};
const STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE = {
  name: "storageChargeDischargeDefaultMode",
  address: 57354,
  kind: "uint16",
  length: 1,
  iobType: "number",
  min: 0,
  max: 7,
  fc: "FC06"
};
const REMOTE_CONTROL_COMMAND_TIMEOUT = {
  name: "remoteControlCommandTimeout",
  address: 57355,
  kind: "uint32",
  length: 2,
  wordOrder: "le",
  iobType: "number",
  unit: "s",
  min: 0,
  max: 86400,
  fc: "FC16"
};
const REMOTE_CONTROL_COMMAND_MODE = {
  name: "remoteControlCommandMode",
  address: 57357,
  kind: "uint16",
  length: 1,
  iobType: "number",
  min: 0,
  max: 7,
  fc: "FC06"
};
const REMOTE_CONTROL_CHARGE_LIMIT = {
  name: "remoteControlChargeLimit",
  address: 57358,
  kind: "float32",
  length: 2,
  wordOrder: "le",
  iobType: "number",
  unit: "W",
  min: 0,
  max: BATTERY_MAX_POWER_W,
  fc: "FC16"
};
const REMOTE_CONTROL_DISCHARGE_LIMIT = {
  name: "remoteControlDischargeLimit",
  address: 57360,
  kind: "float32",
  length: 2,
  wordOrder: "le",
  iobType: "number",
  unit: "W",
  min: 0,
  max: BATTERY_MAX_POWER_W,
  fc: "FC16"
};
const STOREDGE_CONTROL_REGISTERS = [
  STORAGE_CONTROL_MODE,
  STORAGE_AC_CHARGE_POLICY,
  STORAGE_AC_CHARGE_LIMIT,
  STORAGE_BACKUP_RESERVED_SETTING,
  STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE,
  REMOTE_CONTROL_COMMAND_TIMEOUT,
  REMOTE_CONTROL_COMMAND_MODE,
  REMOTE_CONTROL_CHARGE_LIMIT,
  REMOTE_CONTROL_DISCHARGE_LIMIT
];
function findStorEdgeControlDef(name) {
  return STOREDGE_CONTROL_REGISTERS.find((def) => def.name === name);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BATTERY_MAX_POWER_W,
  REMOTE_CONTROL_CHARGE_LIMIT,
  REMOTE_CONTROL_COMMAND_MODE,
  REMOTE_CONTROL_COMMAND_TIMEOUT,
  REMOTE_CONTROL_DISCHARGE_LIMIT,
  STORAGE_AC_CHARGE_LIMIT,
  STORAGE_AC_CHARGE_POLICY,
  STORAGE_BACKUP_RESERVED_SETTING,
  STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE,
  STORAGE_CONTROL_MODE,
  STOREDGE_CONTROL_REGISTERS,
  findStorEdgeControlDef
});
//# sourceMappingURL=storedge-control-map.js.map
