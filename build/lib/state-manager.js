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
var state_manager_exports = {};
__export(state_manager_exports, {
  StateManager: () => StateManager
});
module.exports = __toCommonJS(state_manager_exports);
var import_storedge_control_map = require("./storedge-control-map");
const PARENT_NAMES = {
  meter: "Meter",
  battery: "Battery"
};
function channelDisplayName(channel) {
  if (channel === "inverter") {
    return "Inverter";
  }
  const [group, index] = channel.split(".");
  return `${PARENT_NAMES[group]} ${index}`;
}
const ROLE_MAP = {
  current: "value.current",
  voltage: "value.voltage",
  power: "value.power.active",
  "power.apparent": "value.power",
  "power.reactive": "value.power",
  powerFactor: "value",
  frequency: "value.frequency",
  energy: "value.energy",
  temperature: "value.temperature",
  percent: "value.fill",
  status: "indicator",
  info: "value"
};
const STOREDGE_CONTROL_CHANNEL = "StorEdgeControlBlock";
const STOREDGE_CONTROL_ROLE_MAP = {
  storageControlMode: "level.mode",
  storageAcChargePolicy: "level.mode",
  storageAcChargeLimit: "value.energy",
  storageBackupReservedSetting: "value.fill",
  storageChargeDischargeDefaultMode: "level.mode",
  remoteControlCommandTimeout: "value.interval",
  remoteControlCommandMode: "level.mode",
  remoteControlChargeLimit: "value.power",
  remoteControlDischargeLimit: "value.power"
};
class StateManager {
  adapter;
  /** Channel/parent-folder ids already created this run, to skip redundant object calls. */
  createdChannels = /* @__PURE__ */ new Set();
  /** State ids already ensured this run, to make ensureState a no-op on repeat. */
  ensuredStates = /* @__PURE__ */ new Set();
  constructor(adapter) {
    this.adapter = adapter;
  }
  async ensureChannel(channel) {
    if (channel !== "inverter") {
      const group = channel.split(".")[0];
      await this.ensureContainer(group, "folder", PARENT_NAMES[group]);
    }
    await this.ensureContainer(channel, "channel", channelDisplayName(channel));
  }
  /**
   * Create a channel/folder object once and remember it for the run.
   *
   * @param id - The object id to create (channel path or parent group id).
   * @param type - The ioBroker object type ('folder' for parents, 'channel' otherwise).
   * @param name - The `common.name` display label.
   */
  async ensureContainer(id, type, name) {
    if (this.createdChannels.has(id)) {
      return;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type,
      common: {
        name
      },
      native: {}
    });
    this.createdChannels.add(id);
  }
  async ensureState(channel, def) {
    const id = `${channel}.${def.name}`;
    if (this.ensuredStates.has(id)) {
      return;
    }
    const common = {
      name: def.name,
      type: def.iobType,
      role: ROLE_MAP[def.role],
      read: true,
      write: false
    };
    if (def.unit !== void 0) {
      common.unit = def.unit;
    }
    await this.adapter.setObjectNotExistsAsync(id, {
      type: "state",
      common,
      native: {}
    });
    this.ensuredStates.add(id);
  }
  async writeValue(channel, def, value) {
    if (value === null) {
      return;
    }
    await this.ensureState(channel, def);
    await this.adapter.setStateAsync(`${channel}.${def.name}`, { val: value, ack: true });
  }
  async ensureStorEdgeControlBlock() {
    if (!this.createdChannels.has(STOREDGE_CONTROL_CHANNEL)) {
      await this.adapter.setObjectNotExistsAsync(STOREDGE_CONTROL_CHANNEL, {
        type: "channel",
        common: {
          name: "StorEdge Control Block"
        },
        native: {}
      });
      this.createdChannels.add(STOREDGE_CONTROL_CHANNEL);
    }
    for (const def of import_storedge_control_map.STOREDGE_CONTROL_REGISTERS) {
      const id = `${STOREDGE_CONTROL_CHANNEL}.${def.name}`;
      if (this.ensuredStates.has(id)) {
        continue;
      }
      const common = {
        name: def.name,
        type: "number",
        role: STOREDGE_CONTROL_ROLE_MAP[def.name],
        read: true,
        write: true,
        min: def.min,
        max: def.max
      };
      if (def.unit !== void 0) {
        common.unit = def.unit;
      }
      await this.adapter.setObjectNotExistsAsync(id, {
        type: "state",
        common,
        native: {}
      });
      this.ensuredStates.add(id);
    }
  }
  async writeStorEdgeValue(def, value) {
    await this.ackStorEdgeValue(def, value);
  }
  async ackStorEdgeWrite(def, value) {
    await this.ackStorEdgeValue(def, value);
  }
  /**
   * Shared helper for the poll-read and write-dispatch acknowledgement paths: both
   * write `{ val: value, ack: true }` to `StorEdgeControlBlock.<def.name>` (design
   * section 3). Kept as two distinct public names (`writeStorEdgeValue` /
   * `ackStorEdgeWrite`) so each call site reads clearly.
   *
   * @param def - The StorEdgeControlBlock register definition being written.
   * @param value - The value to write, acknowledged.
   */
  async ackStorEdgeValue(def, value) {
    await this.adapter.setStateAsync(`${STOREDGE_CONTROL_CHANNEL}.${def.name}`, { val: value, ack: true });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StateManager
});
//# sourceMappingURL=state-manager.js.map
