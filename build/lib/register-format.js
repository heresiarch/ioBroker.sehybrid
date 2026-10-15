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
var register_format_exports = {};
__export(register_format_exports, {
  formatAddress: () => formatAddress,
  formatRange: () => formatRange
});
module.exports = __toCommonJS(register_format_exports);
function formatAddress(address) {
  return `0x${address.toString(16).toUpperCase().padStart(4, "0")}`;
}
function formatRange(min, max) {
  const maxLabel = max === Number.MAX_VALUE ? "\u221E" : String(max);
  return `${min}..${maxLabel}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  formatAddress,
  formatRange
});
//# sourceMappingURL=register-format.js.map
