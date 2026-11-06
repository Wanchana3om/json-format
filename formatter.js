(function (root) {
  "use strict";

  const parser = typeof module !== "undefined" && module.exports ? require("./acorn.js") : root.acorn;
  const parserOptions = { ecmaVersion: 2022, preserveParens: true };
  const dataConstructors = new Set([
    "NumberInt", "NumberLong", "NumberDecimal", "Int32", "Long", "Double", "Decimal128",
    "ISODate", "Date", "ObjectId", "ObjectID", "UUID", "BinData", "Binary", "HexData",
    "Timestamp", "MinKey", "MaxKey", "RegExp", "BSONRegExp",
    "Long.fromString", "Long.fromNumber", "Decimal128.fromString", "ObjectId.createFromHexString"
  ]);

  function getTree(source) {
    const expression = parser.parseExpressionAt(source, 0, parserOptions);
    const tail = parser.tokenizer(source.slice(expression.end), parserOptions);
    let token = tail.getToken();
    if (token.type.label === ";") token = tail.getToken();
    if (token.type.label !== "eof") throw new SyntaxError("Unexpected text after document.");

    function readNode(node) {
      const text = source.slice(node.start, node.end);
      if (node.type === "ParenthesizedExpression") return readNode(node.expression);
      if (node.type === "ObjectExpression") {
        const entries = node.properties.map((property) => {
          if (property.type !== "Property" || property.computed || property.method || property.kind !== "init" || property.shorthand) {
            throw new SyntaxError("Only literal data properties are supported.");
          }
          const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
          return [key, readNode(property.value)];
        });
        return { type: "object", entries };
      }
      if (node.type === "ArrayExpression") {
        const entries = node.elements.map((element, index) => {
          if (!element) throw new SyntaxError("Array holes are not supported.");
          return [String(index), readNode(element)];
        });
        return { type: "array", entries };
      }
      if (node.type === "Literal") {
        return { type: node.regex || node.bigint ? "special" : node.value === null ? "null" : typeof node.value, text };
      }
      if (node.type === "TemplateLiteral" && node.expressions.length === 0) return { type: "string", text };
      if (node.type === "Identifier" && ["undefined", "NaN", "Infinity"].includes(node.name)) return { type: "special", text };
      if (node.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
        const argument = readNode(node.argument);
        if (argument.type === "number" || (node.argument.type === "Identifier" && ["NaN", "Infinity"].includes(node.argument.name))) {
          return { type: "number", text };
        }
      }
      if (node.type === "CallExpression" || node.type === "NewExpression") {
        const callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" ? callee.object.name + "." + callee.property.name : "";
        if (dataConstructors.has(name)) {
          node.arguments.forEach(readNode);
          return { type: "special", text };
        }
      }
      throw new SyntaxError("Unsupported expression: " + node.type + ". Only data is allowed.");
    }

    return readNode(expression);
  }

  function documentMode(source) {
    try {
      JSON.parse(source);
      return "json";
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      getTree(source);
      return "object";
    }
  }

  function prettyPrint(source, indent) {
    const tokens = [];
    try {
      const tokenizer = parser.tokenizer(source, {
        ...parserOptions,
        onComment: (block, text, start, end) => tokens.push({ start, end, comment: block ? "block" : "line" })
      });
      for (let token = tokenizer.getToken(); token.type.label !== "eof"; token = tokenizer.getToken()) {
        tokens.push(token);
      }
    } catch {
      const start = tokens.reduce((end, token) => Math.max(end, token.end), 0);
      tokens.push({ start, end: source.length, opaque: true });
    }
    tokens.sort((first, second) => first.start - second.start);
    let result = "";
    let depth = 0;
    const stack = [];
    const newline = () => { result = result.trimEnd() + "\n" + " ".repeat(depth * indent); };

    tokens.forEach((token, index) => {
      const text = source.slice(token.start, token.end);
      const label = token.type ? token.type.label : "";
      const previous = tokens[index - 1];
      const previousText = previous ? source.slice(previous.start, previous.end) : "";
      const next = tokens[index + 1];
      const nextText = next ? source.slice(next.start, next.end) : "";
      if (token.opaque) {
        result += previous && previous.type && previous.type.label === "`" ? text : text.replace(/^\s+/, "");
      } else if (token.comment) {
        if (indent && result.trim()) newline();
        else if (result && !/\s$/.test(result)) result += " ";
        result += text;
        if (token.comment === "line" || indent) newline();
        else result += " ";
      } else if (label === "{" || label === "[") {
        result += text;
        stack.push(text);
        depth += 1;
        if (indent && nextText !== "}" && nextText !== "]") newline();
      } else if (label === "}" || label === "]") {
        stack.pop();
        depth = Math.max(0, depth - 1);
        if (indent && previousText !== "{" && previousText !== "[") newline();
        result += text;
      } else if (label === "(") {
        result += text;
        stack.push(text);
      } else if (label === ")") {
        stack.pop();
        result += text;
      } else if (label === ",") {
        result += ",";
        if (indent && stack[stack.length - 1] !== "(") newline();
        else if (indent) result += " ";
      } else if (label === ":") {
        result += indent ? ": " : ":";
      } else {
        if (result && !/\s$/.test(result) && ((/[\p{ID_Continue}$]$/u.test(previousText) && /^[\p{ID_Continue}$]/u.test(text)) || /[+-]$/.test(previousText) && previousText.slice(-1) === text[0])) result += " ";
        result += text;
      }
    });
    return tokens.length && tokens[tokens.length - 1].opaque ? result : result.trimEnd();
  }

  function findEnd(source, start) {
    const stack = [];
    const tokenizer = parser.tokenizer(source.slice(start), parserOptions);
    for (let token = tokenizer.getToken(); token.type.label !== "eof"; token = tokenizer.getToken()) {
      const character = token.type.label;
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const opening = stack.pop();
        if ((opening === "{" && character !== "}") || (opening === "[" && character !== "]")) {
          throw new SyntaxError("Mismatched data brackets at position " + (start + token.start + 1));
        }
        if (stack.length === 0) return start + token.end;
      }
    }

    throw new SyntaxError("Unclosed JSON block at position " + (start + 1));
  }

  function transformText(source, indent, onBlock, strict = true) {
    if (typeof source !== "string" || !source.trim()) {
      throw new SyntaxError("Paste JSON or a log before formatting.");
    }

    let mode = "";
    try {
      mode = documentMode(source);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }

    if (mode) {
      if (onBlock) onBlock(source, 0);
      return { text: prettyPrint(source, indent), blocks: 1, mode };
    }

    let result = "";
    let cursor = 0;
    let blocks = 0;

    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== "{" && source[index] !== "[") continue;

      const remainder = source.slice(index);
      const traceTag = remainder.match(/^\[!dt(?:[ \t]+[^\[\]{}\r\n]*)?\]/);
      if (traceTag) {
        index += traceTag[0].length - 1;
        continue;
      }
      if (blocks && source[index] === "[") {
        const partialTag = /^\[(?:[A-Z][\w .:-]*|!dt(?:[ \t]+[^\[\]{}\r\n`]*)?)`?\s*$/.test(remainder);
        const emptyTag = /^\[`?\s*$/.test(remainder) && /\[(?:[A-Z][\w .:-]*|!dt(?:[ \t]+[^\[\]{}\r\n]*)?)\][ \t]*$/.test(source.slice(0, index));
        if (partialTag || emptyTag) break;
      }

      let end;
      try {
        end = findEnd(source, index);
      } catch (error) {
        if (strict) throw error;
        end = source.length;
      }
      const candidate = source.slice(index, end);
      try {
        documentMode(candidate);
      } catch (error) {
        if (/^\[(?:[A-Za-z][\w .:-]*|!dt(?:\s+[^\[\]{}]*)?)\]$/.test(candidate)) {
          index = end - 1;
          continue;
        }
        if (strict) throw new SyntaxError("Invalid data at position " + (index + 1) + ": " + error.message);
      }

      if (onBlock) onBlock(candidate, index);
      result += source.slice(cursor, index) + prettyPrint(candidate, indent);
      cursor = end;
      index = end - 1;
      blocks += 1;
    }

    if (!blocks && strict) throw new SyntaxError("No valid JSON object or array found.");
    return { text: result + source.slice(cursor), blocks, mode: "log" };
  }

  function formatText(source, indent = 2) {
    if (![2, 4].includes(indent)) throw new RangeError("Indent must be 2 or 4.");
    return transformText(source, indent);
  }

  function minifyText(source) {
    return transformText(source, 0);
  }

  function formatLooseText(source, indent = 2) {
    if (![0, 2, 4].includes(indent)) throw new RangeError("Indent must be 0, 2 or 4.");
    return transformText(source, indent, undefined, false);
  }

  function formatWholeText(source, indent = 2) {
    if (![0, 2, 4].includes(indent)) throw new RangeError("Indent must be 0, 2 or 4.");
    if (typeof source !== "string" || !source.trim()) throw new SyntaxError("Paste JSON or a log before formatting.");
    try {
      const mode = documentMode(source);
      return { text: prettyPrint(source, indent), blocks: 1, mode };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }

    let result = "";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        result += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (/\s/.test(character)) continue;
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        result += character;
      } else if (character === "{" || character === "[") {
        result += character;
        depth += 1;
        const next = source.slice(index + 1).match(/\S/);
        if (indent && next && next[0] !== "}" && next[0] !== "]") result += "\n" + " ".repeat(depth * indent);
      } else if (character === "}" || character === "]") {
        depth = Math.max(0, depth - 1);
        const previous = result.trimEnd().slice(-1);
        if (indent && previous !== "{" && previous !== "[") result += "\n" + " ".repeat(depth * indent);
        result += character;
      } else if (character === ",") {
        result += indent ? ",\n" + " ".repeat(depth * indent) : ",";
      } else if (character === ":") {
        result += indent ? ": " : ":";
      } else {
        result += character;
      }
    }
    let blocks = 0;
    try {
      blocks = getDocuments(source).length;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    return { text: quote ? result : result.trimEnd(), blocks, mode: "log" };
  }

  function getDocuments(source) {
    const documents = [];
    transformText(source, 0, (text, position) => documents.push({ text, position }));
    return documents;
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function decodeBase64(text) {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  }

  const api = { formatText, minifyText, formatLooseText, formatWholeText, getDocuments, getTree, encodeBase64, decodeBase64 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JSONFormatter = api;
})(globalThis);