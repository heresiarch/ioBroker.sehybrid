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
var sunspec_reader_exports = {};
__export(sunspec_reader_exports, {
  METER_DID_ADDRESS: () => METER_DID_ADDRESS,
  SunSpecReader: () => SunSpecReader,
  planReadChunks: () => planReadChunks
});
module.exports = __toCommonJS(sunspec_reader_exports);
var import_modbus_client = require("./modbus-client");
var import_sunspec_decode = require("./sunspec-decode");
var import_sunspec_map = require("./sunspec-map");
const NOOP_LOGGER = {
  warn: () => {
  },
  debug: () => {
  }
};
const METER_DID_ADDRESS = import_sunspec_map.METER_BASE + 67;
const INVERTER_MODEL_IDS = /* @__PURE__ */ new Set([101, 102, 103]);
const METER_MODEL_IDS = /* @__PURE__ */ new Set([201, 202, 203, 204]);
const METER_SLOTS = [1, 2, 3];
const BATTERY_SLOTS = [1, 2];
const UINT16_SENTINEL = 65535;
function planReadChunks(startAddr, totalLen, maxPerRead = import_modbus_client.MAX_REGISTERS_PER_READ) {
  const chunks = [];
  let remaining = totalLen;
  let address = startAddr;
  while (remaining > 0) {
    const length = Math.min(remaining, maxPerRead);
    chunks.push({ address, length });
    address += length;
    remaining -= length;
  }
  return chunks;
}
class SunSpecReader {
  log;
  constructor(log = NOOP_LOGGER) {
    this.log = log;
  }
  /**
   * Read the inverter model id at {@link INVERTER_BASE} (base-0 register 40069)
   * and return it when it is 101/102/103. Any other value (including the block
   * being absent, which typically decodes to a sentinel or an unexpected id)
   * yields `null` and a warning (Req 3.3, 3.9).
   *
   * @param client
   */
  async detectInverterModel(client) {
    const [raw] = await client.readHoldingRegisters(import_sunspec_map.INVERTER_BASE, 1);
    if (INVERTER_MODEL_IDS.has(raw)) {
      this.log.debug(`Detected inverter model ${raw} at register ${import_sunspec_map.INVERTER_BASE}`);
      return raw;
    }
    this.log.warn(`No SunSpec inverter block detected: register ${import_sunspec_map.INVERTER_BASE} = ${raw} (expected 101/102/103)`);
    return null;
  }
  /**
   * Read the meter model id (`C_SunSpec_DID`) at {@link METER_DID_ADDRESS}
   * (base-0 register 40188) and return it when it is 201/202/203/204. Any other
   * value yields `null` and a warning (Req 3.4, 3.9).
   *
   * @param client
   */
  async detectMeterModel(client) {
    const [raw] = await client.readHoldingRegisters(METER_DID_ADDRESS, 1);
    if (METER_MODEL_IDS.has(raw)) {
      this.log.debug(`Detected meter model ${raw} at register ${METER_DID_ADDRESS}`);
      return raw;
    }
    this.log.warn(
      `No SunSpec meter block detected: register ${METER_DID_ADDRESS} = ${raw} (expected 201/202/203/204)`
    );
    return null;
  }
  /**
   * Read and decode the inverter block for the detected `model`. Reads the whole
   * inverter register span (measurement rows and their sunssf scale rows) in
   * chunks of at most 125 registers, decodes each value, resolves scale factors,
   * and returns one {@link DecodedValue} per inverter measurement value
   * (Req 3.2, 3.6, 3.7, 3.8, 3.10).
   *
   * @param client
   * @param model
   */
  async readInverter(client, model) {
    const blockDefs = import_sunspec_map.SUNSPEC_MAP.filter((d) => d.model === 101);
    const valueDefs = (0, import_sunspec_map.getInverterValueDefs)();
    return this.readBlock(client, import_sunspec_map.INVERTER_BASE, blockDefs, valueDefs, `inverter (model ${model})`);
  }
  /**
   * Read and decode the meter block for the detected `model`. Same algorithm as
   * {@link readInverter} over the meter layout (rows tagged canonical model 201),
   * returning one {@link DecodedValue} per meter measurement value
   * (Req 3.2, 3.4, 3.6, 3.7, 3.8, 3.10).
   *
   * @param client
   * @param model
   */
  async readMeter(client, model) {
    const blockDefs = import_sunspec_map.SUNSPEC_MAP.filter((d) => d.model === 201);
    const valueDefs = (0, import_sunspec_map.getMeterValueDefs)();
    return this.readBlock(client, import_sunspec_map.METER_BASE, blockDefs, valueDefs, `meter (model ${model})`);
  }
  /**
   * Probe meter slots 1..3 for presence and return only the present ones.
   *
   * For each slot the DID register at {@link getMeterDidAddress} is read; the slot
   * is present when the DID is one of the documented meter models 201/202/203/204,
   * in which case `{ index, model }` is included. Any other value (including the
   * uint16 sentinel or 0 for an unpopulated slot) means the slot is absent: it is
   * skipped after a debug log (Req 9.1, 9.2).
   *
   * @param client connected read-only Modbus client
   */
  async detectMeters(client) {
    const detected = [];
    for (const slot of METER_SLOTS) {
      const addr = (0, import_sunspec_map.getMeterDidAddress)(slot);
      const [raw] = await client.readHoldingRegisters(addr, 1);
      if (METER_MODEL_IDS.has(raw)) {
        this.log.debug(`Detected meter.${slot} model ${raw} (DID register ${addr})`);
        detected.push({ index: slot, model: raw });
      } else {
        this.log.debug(`No meter in slot ${slot}: DID register ${addr} = ${raw} (expected 201..204)`);
      }
    }
    return detected;
  }
  /**
   * Probe battery slots 1..2 for presence and return only the present ones.
   *
   * Presence is decided by reading `c_deviceaddress` at {@link getBatteryPresenceAddress}
   * (`0xE140` / `0xE240`): a populated slot reports a real Modbus id (e.g. 112) while an
   * unpopulated slot reads the NOT_IMPLEMENTED sentinel `255` (0x00FF) or `0xFFFF`. The
   * block base word (`0xE100`/`0xE200`) is NOT a reliable signal — verified live, an
   * absent slot 2 still returns a stale identity word at its base (`0x536F`) while every
   * other register in that slot times out, which would falsely detect the slot. A
   * single-register read at `0xE140`/`0xE240` is safe for both present and absent slots.
   * Absent slots are skipped after a debug log (Req 10.1). Verified against a live
   * SolarEdge Home Battery.
   *
   * @param client connected read-only Modbus client
   */
  async detectBatteries(client) {
    const detected = [];
    for (const slot of BATTERY_SLOTS) {
      const addr = (0, import_sunspec_map.getBatteryPresenceAddress)(slot);
      let raw;
      try {
        [raw] = await client.readHoldingRegisters(addr, 1);
      } catch (e) {
        this.log.debug(`No battery in slot ${slot}: presence read at ${addr} failed (${describeError(e)})`);
        continue;
      }
      const probe = raw & 65535;
      if (probe !== UINT16_SENTINEL && probe !== 255 && probe !== 0) {
        this.log.debug(`Detected battery.${slot} (presence register ${addr} = ${probe})`);
        detected.push({ index: slot, did: probe });
      } else {
        this.log.debug(`No battery in slot ${slot}: presence register ${addr} = ${probe} (absent)`);
      }
    }
    return detected;
  }
  /**
   * Read and decode a present meter slot at its per-slot base address.
   *
   * Reuses the shared meter template (rows tagged canonical model 201) and its
   * scale-factor resolution; only the block base changes per slot
   * ({@link getMeterBase}), so meter.2/3 offsets resolve correctly relative to
   * their region (Req 9.2, 9.3).
   *
   * @param client connected read-only Modbus client
   * @param meter the present meter slot to read (from {@link detectMeters})
   */
  async readMeterSlot(client, meter) {
    const base = (0, import_sunspec_map.getMeterBase)(meter.index);
    const blockDefs = import_sunspec_map.SUNSPEC_MAP.filter((d) => d.model === 201);
    const valueDefs = (0, import_sunspec_map.getMeterValueDefs)();
    return this.readBlock(client, base, blockDefs, valueDefs, `meter.${meter.index} (model ${meter.model})`);
  }
  /**
   * Read and decode a present battery slot at its per-slot base address.
   *
   * The SolarEdge battery block is NOT one contiguous readable region: it is split
   * into two readable segments ({@link BATTERY_READ_SEGMENTS}) separated by an
   * unmapped gap, and the device rejects (times out) any Modbus read that crosses
   * the gap or over-reads a segment. So this must NOT use the single min..max span
   * sweep that {@link readBlock} performs; instead each segment is read as its own
   * contiguous request and reassembled by offset. Any value def that falls (even
   * partly) in the gap — i.e. whose words were not read by any segment — is skipped.
   *
   * Battery values carry no `sunssf`/`scaleFactorRef`, so no scale resolution is
   * needed; decoded float32le / uint32le / uint64 values pass through unchanged, and
   * a NOT_IMPLEMENTED sentinel decodes to `null` (Req 10.2, 10.3, 10.4, 10.8).
   *
   * @param client connected read-only Modbus client
   * @param battery the present battery slot to read (from {@link detectBatteries})
   */
  async readBatterySlot(client, battery) {
    const base = (0, import_sunspec_map.getBatteryBase)(battery.index);
    return this.readSegmentedBlock(
      client,
      base,
      import_sunspec_map.BATTERY_READ_SEGMENTS,
      (0, import_sunspec_map.getBatteryValueDefs)(),
      `battery.${battery.index}`
    );
  }
  /**
   * Read a device block that is split into several contiguous read segments with
   * unmapped gaps between them, decoding only the value defs whose words are fully
   * covered by one of the segments.
   *
   * Each segment is read as its own Modbus request (chunked to <=125 registers within
   * the segment) — a read is never issued across a gap. The read words are collected
   * into a sparse map keyed by word offset (relative to `base`). A value def decodes
   * only when every word it spans is present in the map; a def landing in a gap is
   * skipped with a debug log (it produces no state, Req 10.9-style). These blocks
   * carry no scale factors, so values decode directly.
   *
   * @param client   connected read-only Modbus client
   * @param base     base-0 register address of the block (segment/def offsets are relative to it)
   * @param segments the readable segments (word offset + length, relative to `base`)
   * @param valueDefs the measurement value defs to emit as {@link DecodedValue}[]
   * @param label    human-readable block label for log messages
   */
  async readSegmentedBlock(client, base, segments, valueDefs, label) {
    const wordAt = /* @__PURE__ */ new Map();
    for (const segment of segments) {
      const startAddr = base + segment.offset;
      const chunks = planReadChunks(startAddr, segment.length);
      for (const chunk of chunks) {
        const data = await client.readHoldingRegisters(chunk.address, chunk.length);
        const baseOffset = chunk.address - base;
        for (let i = 0; i < data.length; i++) {
          wordAt.set(baseOffset + i, data[i]);
        }
      }
    }
    this.log.debug(`Read ${label} block: ${segments.length} segment(s), ${wordAt.size} registers`);
    const results = [];
    for (const def of valueDefs) {
      const words = [];
      let complete = true;
      for (let i = 0; i < def.length; i++) {
        const w = wordAt.get(def.offset + i);
        if (w === void 0) {
          complete = false;
          break;
        }
        words.push(w);
      }
      if (!complete) {
        this.log.debug(`Skipping ${label} value "${def.name}": not in a readable segment`);
        continue;
      }
      const value = (0, import_sunspec_decode.decodeRegisters)(words, def.datatype);
      results.push({ def, value });
    }
    return results;
  }
  /**
   * Shared block read/decode pipeline.
   *
   * @param client    connected read-only Modbus client
   * @param base      base-0 register address of the block (offsets are relative to it)
   * @param blockDefs ALL defs in the block (measurement rows AND sunssf scale rows) —
   *                  scale rows are needed to resolve scale factors
   * @param valueDefs the measurement value defs to emit as {@link DecodedValue}[]
   * @param label     human-readable block label for log messages
   */
  async readBlock(client, base, blockDefs, valueDefs, label) {
    let minOffset = Infinity;
    let maxEnd = 0;
    for (const def of blockDefs) {
      if (def.offset < minOffset) {
        minOffset = def.offset;
      }
      if (def.offset + def.length > maxEnd) {
        maxEnd = def.offset + def.length;
      }
    }
    const spanLen = maxEnd - minOffset;
    const startAddr = base + minOffset;
    const words = new Array(spanLen);
    const chunks = planReadChunks(startAddr, spanLen);
    for (const chunk of chunks) {
      const data = await client.readHoldingRegisters(chunk.address, chunk.length);
      const writeStart = chunk.address - startAddr;
      for (let i = 0; i < data.length; i++) {
        words[writeStart + i] = data[i];
      }
    }
    this.log.debug(`Read ${label} block: ${spanLen} registers from ${startAddr} in ${chunks.length} chunk(s)`);
    const wordsFor = (def) => {
      const start = def.offset - minOffset;
      return words.slice(start, start + def.length);
    };
    const scaleValues = /* @__PURE__ */ new Map();
    for (const def of blockDefs) {
      if (def.datatype === "sunssf") {
        const decoded = (0, import_sunspec_decode.decodeRegisters)(wordsFor(def), def.datatype);
        scaleValues.set(def.name, typeof decoded === "number" ? decoded : null);
      }
    }
    const results = [];
    for (const def of valueDefs) {
      const raw = (0, import_sunspec_decode.decodeRegisters)(wordsFor(def), def.datatype);
      if (raw === null) {
        results.push({ def, value: null });
        continue;
      }
      if (!def.scaleFactorRef) {
        results.push({ def, value: raw });
        continue;
      }
      const sf = scaleValues.get(def.scaleFactorRef);
      if (sf === void 0 || sf === null) {
        this.log.warn(
          `Skipping ${label} value "${def.name}": scale factor "${def.scaleFactorRef}" is missing or unavailable`
        );
        results.push({ def, value: null });
        continue;
      }
      try {
        const scaled = (0, import_sunspec_decode.applyScaleFactor)(raw, sf);
        results.push({ def, value: scaled });
      } catch {
        this.log.warn(`Skipping ${label} value "${def.name}": scale factor ${sf} is out of range [-10, 10]`);
        results.push({ def, value: null });
      }
    }
    return results;
  }
}
function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  METER_DID_ADDRESS,
  SunSpecReader,
  planReadChunks
});
//# sourceMappingURL=sunspec-reader.js.map
