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
var objpack_exports = {};
__export(objpack_exports, {
  SLObjPack: () => SLObjPack
});
module.exports = __toCommonJS(objpack_exports);
const DEFAULT_LIMITS = {
  depth: 512,
  arrayLength: 1 << 20,
  // ~1M items
  objectKeys: 1 << 16,
  // 64K keys
  streamLength: 1 << 24,
  // ~16M stream entries
  valuesLength: 1 << 22,
  // ~4M unique values
  decodeOps: 1 << 22
  // Combined budget for schema arrays
};
const DEFAULT_FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  "__proto__",
  "constructor",
  "prototype"
]);
class SLObjPack {
  limits;
  forbiddenKeys;
  constructor(options = {}) {
    const overrides = options.limits ?? {};
    this.limits = {
      depth: overrides.depth ?? DEFAULT_LIMITS.depth,
      arrayLength: overrides.arrayLength ?? DEFAULT_LIMITS.arrayLength,
      objectKeys: overrides.objectKeys ?? DEFAULT_LIMITS.objectKeys,
      streamLength: overrides.streamLength ?? DEFAULT_LIMITS.streamLength,
      valuesLength: overrides.valuesLength ?? DEFAULT_LIMITS.valuesLength,
      decodeOps: overrides.decodeOps ?? DEFAULT_LIMITS.decodeOps
    };
    this.forbiddenKeys = options.forbiddenKeys ? new Set(options.forbiddenKeys) : new Set(DEFAULT_FORBIDDEN_KEYS);
  }
  pack(jsonObj) {
    const limits = this.limits;
    const forbiddenKeys = this.forbiddenKeys;
    const seen = /* @__PURE__ */ new WeakSet();
    function snapshot(node, depth) {
      if (depth > limits.depth) {
        throw new Error("SLObjPack pack: Max depth exceeded");
      }
      if (node === null) return null;
      const t = typeof node;
      if (t === "string" || t === "boolean") return node;
      if (t === "number") {
        if (!Number.isFinite(node)) {
          throw new Error("SLObjPack pack: Non-finite number not supported");
        }
        return node;
      }
      if (t !== "object") {
        throw new Error("SLObjPack pack: Unsupported value type: " + t);
      }
      const objNode = node;
      if (seen.has(objNode)) {
        throw new Error("SLObjPack pack: Circular reference detected");
      }
      seen.add(objNode);
      try {
        if (Array.isArray(node)) {
          const len = node.length;
          if (len > limits.arrayLength) {
            throw new Error("SLObjPack pack: Array length exceeds limit");
          }
          const out2 = new Array(len);
          for (let i = 0; i < len; i++) {
            out2[i] = snapshot(node[i], depth + 1);
          }
          return out2;
        }
        const proto = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== null) {
          throw new Error("SLObjPack pack: Non-plain object not supported");
        }
        const record = node;
        const keys = Object.keys(record);
        if (keys.length > limits.objectKeys) {
          throw new Error("SLObjPack pack: Object key count exceeds limit");
        }
        const out = {};
        for (const k of keys) {
          if (forbiddenKeys.has(k)) {
            throw new Error("SLObjPack pack: Forbidden key: " + k);
          }
          Object.defineProperty(out, k, {
            value: snapshot(record[k], depth + 1),
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
        return out;
      } finally {
        seen.delete(objNode);
      }
    }
    const safe = snapshot(jsonObj, 0);
    const primitivesFrequency = /* @__PURE__ */ new Map();
    function countPrimitives(node, depth) {
      if (depth > limits.depth) {
        throw new Error("SLObjPack pack: Max depth exceeded");
      }
      if (node === null || typeof node !== "object") {
        const prim = node;
        primitivesFrequency.set(prim, (primitivesFrequency.get(prim) ?? 0) + 1);
        return;
      }
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          countPrimitives(node[i], depth + 1);
        }
      } else {
        const obj = node;
        const keys = Object.keys(obj);
        for (const k of keys) {
          primitivesFrequency.set(k, (primitivesFrequency.get(k) ?? 0) + 1);
          countPrimitives(obj[k], depth + 1);
        }
      }
    }
    countPrimitives(safe, 0);
    const valuesList = Array.from(primitivesFrequency.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const valueToIndex = /* @__PURE__ */ new Map();
    valuesList.forEach((val, idx) => valueToIndex.set(val, idx));
    const getPtr = (node) => {
      const ptr = valueToIndex.get(node);
      if (ptr === void 0) {
        throw new Error("SLObjPack pack: Internal error \u2014 unindexed primitive");
      }
      return ptr;
    };
    function isSchemaArray(arr) {
      if (arr.length === 0) return false;
      const first = arr[0];
      if (typeof first !== "object" || first === null || Array.isArray(first)) return false;
      const keys0 = Object.keys(first);
      if (keys0.length === 0) return false;
      for (let i = 1; i < arr.length; i++) {
        const item = arr[i];
        if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
        const keysI = Object.keys(item);
        if (keysI.length !== keys0.length) return false;
        for (let k = 0; k < keys0.length; k++) {
          if (keysI[k] !== keys0[k]) return false;
        }
      }
      return keys0;
    }
    const stream = [];
    function emit(node, depth) {
      if (depth > limits.depth) {
        throw new Error("SLObjPack pack: Max depth exceeded");
      }
      if (node === null || typeof node !== "object") {
        stream.push(getPtr(node));
        return;
      }
      if (Array.isArray(node)) {
        if (node.length === 0) {
          stream.push(-4);
          return;
        }
        if (node.length === 1) {
          stream.push(-5);
          emit(node[0], depth + 1);
          return;
        }
        const schemaKeys = isSchemaArray(node);
        if (schemaKeys) {
          stream.push(-3);
          stream.push(node.length);
          stream.push(schemaKeys.length);
          schemaKeys.forEach((k) => stream.push(getPtr(k)));
          node.forEach((item) => {
            const rec = item;
            schemaKeys.forEach((k) => emit(rec[k], depth + 1));
          });
          return;
        }
        stream.push(-2);
        stream.push(node.length);
        node.forEach((n) => emit(n, depth + 1));
        return;
      }
      const objNode = node;
      const keys = Object.keys(objNode);
      if (keys.length === 0) {
        stream.push(-6);
        return;
      }
      stream.push(-1);
      stream.push(keys.length);
      keys.forEach((k) => stream.push(getPtr(k)));
      keys.forEach((k) => emit(objNode[k], depth + 1));
    }
    emit(safe, 0);
    return [valuesList, stream];
  }
  unpack(packed) {
    const limits = this.limits;
    const forbiddenKeys = this.forbiddenKeys;
    if (!Array.isArray(packed) || packed.length !== 2) {
      throw new Error("SLObjPack unpack: Invalid payload structure");
    }
    const valuesListRaw = packed[0];
    const streamRaw = packed[1];
    if (!Array.isArray(valuesListRaw) || !Array.isArray(streamRaw)) {
      throw new Error("SLObjPack unpack: Invalid payload structure");
    }
    if (valuesListRaw.length > limits.valuesLength) {
      throw new Error("SLObjPack unpack: valuesList exceeds limit");
    }
    if (streamRaw.length > limits.streamLength) {
      throw new Error("SLObjPack unpack: stream exceeds limit");
    }
    for (let i = 0; i < valuesListRaw.length; i++) {
      const v = valuesListRaw[i];
      if (v === null) continue;
      const t = typeof v;
      if (t === "string" || t === "boolean") continue;
      if (t === "number") {
        if (!Number.isFinite(v)) {
          throw new Error("SLObjPack unpack: Non-finite number in valuesList at " + i);
        }
        continue;
      }
      throw new Error("SLObjPack unpack: Invalid valuesList entry at " + i + " (type " + t + ")");
    }
    const valuesList = valuesListRaw;
    const stream = streamRaw;
    const streamLen = stream.length;
    const valuesLen = valuesList.length;
    let cursor = 0;
    function readStream() {
      if (cursor >= streamLen) {
        throw new Error("SLObjPack unpack: Unexpected end of stream");
      }
      return stream[cursor++];
    }
    function resolvePointer(ptr) {
      if (typeof ptr !== "number" || !Number.isInteger(ptr) || ptr < 0 || ptr >= valuesLen) {
        throw new Error("SLObjPack unpack: Invalid value pointer " + ptr);
      }
      return valuesList[ptr];
    }
    function readKey() {
      const key = resolvePointer(readStream());
      if (typeof key !== "string") {
        throw new Error("SLObjPack unpack: Keys must be strings, got " + typeof key);
      }
      if (forbiddenKeys.has(key)) {
        throw new Error("SLObjPack unpack: Forbidden key: " + key);
      }
      return key;
    }
    function safeSet(obj, key, value) {
      Object.defineProperty(obj, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    function validateCount(n, max, label) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > max) {
        throw new Error("SLObjPack unpack: Invalid " + label + " count: " + n);
      }
    }
    function requireStream(min, label) {
      if (min > streamLen - cursor) {
        throw new Error("SLObjPack unpack: " + label + " exceeds remaining stream");
      }
    }
    function decode(depth) {
      if (depth > limits.depth) {
        throw new Error("SLObjPack unpack: Max depth exceeded");
      }
      const op = readStream();
      if (typeof op !== "number" || !Number.isInteger(op)) {
        throw new Error("SLObjPack unpack: Invalid opcode " + op);
      }
      if (op >= 0) return resolvePointer(op);
      switch (op) {
        case -1: {
          const numKeys = readStream();
          validateCount(numKeys, limits.objectKeys, "object key");
          requireStream(numKeys * 2, "object");
          const keys = new Array(numKeys);
          for (let i = 0; i < numKeys; i++) keys[i] = readKey();
          const obj = {};
          for (let i = 0; i < numKeys; i++) safeSet(obj, keys[i], decode(depth + 1));
          return obj;
        }
        case -2: {
          const numItems = readStream();
          validateCount(numItems, limits.arrayLength, "array item");
          requireStream(numItems, "array");
          const arr = new Array(numItems);
          for (let i = 0; i < numItems; i++) arr[i] = decode(depth + 1);
          return arr;
        }
        case -3: {
          const numItems = readStream();
          validateCount(numItems, limits.arrayLength, "schema array item");
          const numKeys = readStream();
          validateCount(numKeys, limits.objectKeys, "schema key");
          if (numItems * numKeys > limits.decodeOps) {
            throw new Error("SLObjPack unpack: Schema array decode budget exceeded");
          }
          requireStream(numKeys + numItems * numKeys, "schema array");
          const keys = new Array(numKeys);
          for (let i = 0; i < numKeys; i++) keys[i] = readKey();
          const arr = new Array(numItems);
          for (let i = 0; i < numItems; i++) {
            const obj = {};
            for (let k = 0; k < numKeys; k++) {
              safeSet(obj, keys[k], decode(depth + 1));
            }
            arr[i] = obj;
          }
          return arr;
        }
        case -4:
          return [];
        case -5:
          return [decode(depth + 1)];
        case -6:
          return {};
        default:
          throw new Error("SLObjPack unpack: Unknown opcode " + op);
      }
    }
    const result = decode(0);
    if (cursor !== streamLen) {
      throw new Error("SLObjPack unpack: Extra data after decoding");
    }
    return result;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SLObjPack
});
