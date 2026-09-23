"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var modbus_client_exports = {};
__export(modbus_client_exports, {
  DEFAULT_TIMEOUT_MS: () => DEFAULT_TIMEOUT_MS,
  MAX_REGISTERS_PER_READ: () => MAX_REGISTERS_PER_READ,
  ModbusClient: () => ModbusClient
});
module.exports = __toCommonJS(modbus_client_exports);
var import_modbus_serial = __toESM(require("modbus-serial"));
const DEFAULT_TIMEOUT_MS = 1e4;
const MAX_REGISTERS_PER_READ = 125;
function rejectAfter(ms, message) {
  let handle;
  const promise = new Promise((_resolve, reject) => {
    handle = globalThis.setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => globalThis.clearTimeout(handle) };
}
class ModbusClient {
  client;
  /** Our own connected flag, combined with the library's `isOpen` in {@link isConnected}. */
  connected = false;
  constructor() {
    this.client = new import_modbus_serial.default();
  }
  /**
   * Open a TCP connection to the inverter and select the Modbus unit id.
   *
   * The connect attempt is bounded by `timeoutMs` (default 10s, Req 7.4): the
   * library connect timeout is set via the TCP options and the whole attempt is
   * additionally raced against a rejecting timeout. The same timeout is applied
   * via `setTimeout` so subsequent read requests inherit the deadline (Req 3.5).
   *
   * @param host
   * @param port
   * @param unitId
   * @param timeoutMs
   */
  async connect(host, port, unitId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const timeout = rejectAfter(timeoutMs, `Modbus connect to ${host}:${port} timed out after ${timeoutMs} ms`);
    try {
      await Promise.race([this.client.connectTCP(host, { port, timeout: timeoutMs }), timeout.promise]);
      this.client.setID(unitId);
      this.client.setTimeout(timeoutMs);
      this.connected = true;
    } catch (err) {
      this.connected = false;
      try {
        await this.close();
      } catch {
      }
      throw new Error(`Failed to connect to ${host}:${port} (unit ${unitId}): ${describeError(err)}`);
    } finally {
      timeout.cancel();
    }
  }
  /**
   * FC03 — read holding registers.
   *
   * @param address
   * @param length
   * @param opts
   */
  async readHoldingRegisters(address, length, opts) {
    return this.read("readHoldingRegisters", address, length, opts);
  }
  /**
   * FC04 — read input registers.
   *
   * @param address
   * @param length
   * @param opts
   */
  async readInputRegisters(address, length, opts) {
    return this.read("readInputRegisters", address, length, opts);
  }
  /**
   * FC06 — write a single uint16 value to a holding register (Req 2.1). The value
   * must be an integer in `[0, 0xFFFF]`. Rejects when not connected (Req 2.5).
   *
   * @param address
   * @param value
   * @param opts
   */
  async writeSingleRegister(address, value, opts) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new Error(`Invalid register value ${value}: must be an integer in [0, 65535]`);
    }
    await this.write("writeRegister", address, value, opts);
  }
  /**
   * FC16 — write a uint16 word array to consecutive holding registers (Req 2.2).
   * The array must be non-empty and every word an integer in `[0, 0xFFFF]`.
   * Rejects when not connected (Req 2.5).
   *
   * @param address
   * @param values
   * @param opts
   */
  async writeMultipleRegisters(address, values, opts) {
    if (!Array.isArray(values) || values.length < 1) {
      throw new Error("Invalid register values: must be a non-empty word array");
    }
    for (const word of values) {
      if (!Number.isInteger(word) || word < 0 || word > 65535) {
        throw new Error(`Invalid register word ${word}: must be an integer in [0, 65535]`);
      }
    }
    await this.write("writeRegisters", address, values, opts);
  }
  isConnected() {
    return this.connected && this.client.isOpen;
  }
  /**
   * Close the socket. Safe to call when not connected (no-op). Resolves within
   * `DEFAULT_TIMEOUT_MS` even if the underlying close callback never fires (Req 7.6).
   */
  async close() {
    this.connected = false;
    if (!this.client.isOpen) {
      return;
    }
    await new Promise((resolve) => {
      const handle = globalThis.setTimeout(resolve, DEFAULT_TIMEOUT_MS);
      try {
        this.client.close(() => {
          globalThis.clearTimeout(handle);
          resolve();
        });
      } catch {
        globalThis.clearTimeout(handle);
        resolve();
      }
    });
  }
  /**
   * Shared implementation for the two read function codes. Guards the register
   * count (Req 3.2), enforces the per-request timeout (Req 3.5), requires an open
   * connection, and returns the numeric register data. Rejects with a descriptive
   * Error rather than throwing synchronously.
   *
   * @param fn
   * @param address
   * @param length
   * @param opts
   */
  async read(fn, address, length, opts) {
    var _a;
    const timeoutMs = (_a = opts == null ? void 0 : opts.timeoutMs) != null ? _a : DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(length) || length < 1) {
      throw new Error(`Invalid register length ${length}: must be a positive integer`);
    }
    if (length > MAX_REGISTERS_PER_READ) {
      throw new Error(`Cannot read ${length} registers in one request: maximum is ${MAX_REGISTERS_PER_READ}`);
    }
    if (!this.isConnected()) {
      throw new Error("Modbus client is not connected");
    }
    this.client.setTimeout(timeoutMs);
    const timeout = rejectAfter(timeoutMs, `Modbus ${fn} at ${address}+${length} timed out after ${timeoutMs} ms`);
    try {
      const result = await Promise.race([this.client[fn](address, length), timeout.promise]);
      return result.data;
    } catch (err) {
      throw new Error(`Modbus ${fn} at address ${address} (length ${length}) failed: ${describeError(err)}`);
    } finally {
      timeout.cancel();
    }
  }
  /**
   * Shared implementation for the two write function codes. Mirrors {@link read}:
   * requires an open connection (rejecting before any library call is issued,
   * Req 2.5), applies the per-request timeout (Req 2.6), and races the library
   * call against a rejecting timeout so a hung write cannot exceed the deadline.
   * Rejects with a descriptive Error rather than throwing synchronously.
   *
   * @param fn
   * @param address
   * @param payload
   * @param opts
   */
  async write(fn, address, payload, opts) {
    var _a;
    const timeoutMs = (_a = opts == null ? void 0 : opts.timeoutMs) != null ? _a : DEFAULT_TIMEOUT_MS;
    if (!this.isConnected()) {
      throw new Error("Modbus client is not connected");
    }
    this.client.setTimeout(timeoutMs);
    const timeout = rejectAfter(timeoutMs, `Modbus ${fn} at ${address} timed out after ${timeoutMs} ms`);
    try {
      const call = fn === "writeRegister" ? this.client.writeRegister(address, payload) : this.client.writeRegisters(address, payload);
      await Promise.race([call, timeout.promise]);
    } catch (err) {
      throw new Error(`Modbus ${fn} at address ${address} failed: ${describeError(err)}`);
    } finally {
      timeout.cancel();
    }
  }
}
function describeError(err) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_REGISTERS_PER_READ,
  ModbusClient
});
//# sourceMappingURL=modbus-client.js.map
