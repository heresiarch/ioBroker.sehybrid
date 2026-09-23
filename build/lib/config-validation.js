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
var config_validation_exports = {};
__export(config_validation_exports, {
  CONFIG_BOUNDS: () => CONFIG_BOUNDS,
  validateConfig: () => validateConfig
});
module.exports = __toCommonJS(config_validation_exports);
const CONFIG_BOUNDS = {
  /** Inverter host string length, 1..253 chars (Req 1.1). */
  host: { minLength: 1, maxLength: 253 },
  /** Modbus TCP port, integer 1..65535 (Req 1.2). */
  port: { min: 1, max: 65535 },
  /** Modbus unit identifier, integer 0..247 (Req 1.4). */
  unitId: { min: 0, max: 247 },
  /** Polling interval in seconds, integer 5..3600 (Req 5.1). */
  pollInterval: { min: 5, max: 3600 }
};
function validateConfig(cfg) {
  const errors = {};
  const { host } = cfg;
  if (typeof host !== "string") {
    errors.host = "host must be a string";
  } else if (host.length < CONFIG_BOUNDS.host.minLength) {
    errors.host = "host must not be empty";
  } else if (host.length > CONFIG_BOUNDS.host.maxLength) {
    errors.host = `host must be at most ${CONFIG_BOUNDS.host.maxLength} characters`;
  }
  const { port } = cfg;
  if (!Number.isInteger(port)) {
    errors.port = "port must be an integer";
  } else if (port < CONFIG_BOUNDS.port.min || port > CONFIG_BOUNDS.port.max) {
    errors.port = `port must be between ${CONFIG_BOUNDS.port.min} and ${CONFIG_BOUNDS.port.max}`;
  }
  const { unitId } = cfg;
  if (!Number.isInteger(unitId)) {
    errors.unitId = "unitId must be an integer";
  } else if (unitId < CONFIG_BOUNDS.unitId.min || unitId > CONFIG_BOUNDS.unitId.max) {
    errors.unitId = `unitId must be between ${CONFIG_BOUNDS.unitId.min} and ${CONFIG_BOUNDS.unitId.max}`;
  }
  const { pollInterval } = cfg;
  if (!Number.isInteger(pollInterval)) {
    errors.pollInterval = "pollInterval must be an integer";
  } else if (pollInterval < CONFIG_BOUNDS.pollInterval.min || pollInterval > CONFIG_BOUNDS.pollInterval.max) {
    errors.pollInterval = `pollInterval must be between ${CONFIG_BOUNDS.pollInterval.min} and ${CONFIG_BOUNDS.pollInterval.max} seconds`;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CONFIG_BOUNDS,
  validateConfig
});
//# sourceMappingURL=config-validation.js.map
