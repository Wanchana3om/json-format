const test = require("node:test");
const assert = require("node:assert/strict");
const { formatText, minifyText, formatLooseText, formatWholeText, getDocuments, getTree } = require("./formatter.js");

test("formats JSON with nested arrays and empty containers", () => {
  const input = '{"items":[{"ok":true},null,[],{}],"name":"sample"}';
  const result = formatText(input);
  assert.equal(result.text, JSON.stringify(JSON.parse(input), null, 2));
  assert.equal(result.blocks, 1);
  assert.equal(result.mode, "json");
});

test("formats BODY and HEADERS without changing the log prefix", () => {
  const prefix = "2026-11-02T13:46:12.907+07:00 [INFO] [APIInterceptor] INCOMING|METHOD|POST|PATHNAME|/action/queryOrderInformation|BODY|";
  const body = '{"transactionID":"demo","orderNo":"ORDER-001","mobileNo":""}';
  const headers = '{"host":"api.example.test","content-type":"application/json"}';
  const result = formatText(prefix + body + "|HEADERS|" + headers);
  assert.equal(result.text, prefix + JSON.stringify(JSON.parse(body), null, 2) + "|HEADERS|" + JSON.stringify(JSON.parse(headers), null, 2));
  assert.equal(result.blocks, 2);
  assert.equal(result.mode, "log");
});

test("preserves Dynatrace metadata while formatting request and response JSON", () => {
  const prefix = "2026-10-29T17:24:09.660+07:00 [INFO] [RestService] [!dt dt.trace_id=demo-trace,dt.span_id=demo-span,dt.trace_sampled=true ] |FUNCTION|call|METHOD|post|URL|http://api.example.test/action/persoSimStatus|HEADERS|";
  const headers = '{"Authorization":"Bearer demo"}';
  const request = '{"transactionID":"demo","channel":"NCP","orderNo":"ORDER-001"}';
  const response = '{"isError":false,"status":200,"data":{"result":{"result":[{"orderStatus":"Pending"}]}}}';
  const suffix = "|STARTTIME|2026-10-29T17:24:08.458+07:00|DURATION|1201";
  const input = prefix + headers + "|REQUEST|" + request + "|RESPONSE|" + response + suffix;

  for (const indent of [2, 4]) {
    const result = formatText(input, indent);
    assert.equal(result.text, prefix + JSON.stringify(JSON.parse(headers), null, indent) + "|REQUEST|" + JSON.stringify(JSON.parse(request), null, indent) + "|RESPONSE|" + JSON.stringify(JSON.parse(response), null, indent) + suffix);
    assert.equal(result.blocks, 3);
    assert.equal(result.mode, "log");
    assert.deepEqual(formatText(result.text, indent), result);
  }

  assert.throws(() => formatText(prefix + '{"bad":}'), SyntaxError);
});

test("preserves braces, pipe separators, whitespace, and escaped quotes inside strings", () => {
  const input = JSON.stringify({ text: 'a  b |HEADERS| [INFO] { } \\ "quoted"', lines: "one\ntwo" });
  assert.deepEqual(JSON.parse(formatText(input).text), JSON.parse(input));
});

test("preserves large numbers, numeric spelling, duplicate keys, and unicode escapes", () => {
  const result = formatText('{"id":90071992547409931234,"rate":1.00e+3,"id":2,"text":"\\u0061"}');
  assert.equal(result.text, '{\n  "id": 90071992547409931234,\n  "rate": 1.00e+3,\n  "id": 2,\n  "text": "\\u0061"\n}');
});

test("supports four spaces, primitives, and multiple log lines", () => {
  assert.equal(formatText('{"ok":true}', 4).text, '{\n    "ok": true\n}');
  for (const primitive of ['"hello"', "true", "null", "123"]) {
    assert.equal(formatText(primitive).text, primitive);
  }
  const result = formatText('[INFO] {"a":1}\r\n[DEBUG] [1,2]');
  assert.equal(result.blocks, 2);
  assert.ok(result.text.includes("\r\n[DEBUG] [\n"));
});

test("formatting is idempotent", () => {
  const first = formatText('[INFO] BODY|{"a":[1,2]}|HEADERS|{"b":{}}');
  assert.deepEqual(formatText(first.text), first);
});

test("formats multiline logs with backticks and a truncated final service tag", () => {
  const trace = "[!dt dt.trace_id=demo,dt.span_id=span,dt.trace_sampled=true]";
  const lines = [
    '[LoggingInterceptor] ' + trace + ' |HEADERS|{"host":"example.test"}|BODY|{"transactionId":"demo"}',
    '[MongoDbService] ' + trace + ' |REQUEST|{"update":{"$set":{"status":"102"}}}|RESPONSE|{"modifiedCount":1}',
    '[RestService] ' + trace + ' |HEADERS|{}|REQUEST|{"channel":"NCP"}|RESPONSE|{"data":{"result":[{"orderStatus":"Pending"}]}}',
    '[SproService] ' + trace + ' |REQUEST|{}|RESPONSE|{"result":[{"orderStatus":"Pending"}]}',
    '[MongoDbSe'
  ];
  const input = lines.map((line) => '`2026-10-29T17:24:09.660+07:00 [INFO] ' + line + '`').join("\r\n");
  const result = formatText(input);
  assert.equal(result.blocks, 9);
  assert.equal(result.mode, "log");
  assert.ok(result.text.endsWith('`2026-10-29T17:24:09.660+07:00 [INFO] [MongoDbSe`'));
  assert.ok(result.text.includes('"orderStatus": "Pending"'));
  assert.deepEqual(formatText(result.text), result);
  assert.throws(() => formatText('[INFO] BODY|{}\nBODY|[true'), SyntaxError);
});

test("formats all log blocks when Dynatrace IDs begin with digits", () => {
  const trace = "[!dt dt.trace_id=0a1b2c3d4e5f6789,dt.span_id=2d2e7fd38c2fa25c,dt.trace_sampled=true]";
  const request = '{"transactionID":"demo","channel":"NCP","orderNo":"ORDER-001"}';
  const response = '{"data":{"result":[{"orderStatus":"Pending"}]}}';
  const documents = [
    '{"Authorization":"Bearer demo"}', request, response,
    request, response,
    '{"model":"sale_provisionings","update":{"$set":{"progress.status":{"statusCode":"200"}}}}', '{"acknowledged":true,"modifiedCount":1}',
    '{"key":"demo","value":{"request":' + request + ',"response":' + response + '}}', '[{"topicName":"progress-change","partition":0,"baseOffset":"8098"}]'
  ];
  const lines = [
    trace + ' |FUNCTION|call|URL|http://api.example.test/action/persoSimStatus|HEADERS|' + documents[0] + '|REQUEST|' + documents[1] + '|RESPONSE|' + documents[2] + '|DURATION|1201',
    '2026-10-29T17:24:09.660+07:00 [INFO] [SproService] ' + trace + ' |REQUEST|' + documents[3] + '|RESPONSE|' + documents[4] + '|DURATION|1260',
    '2026-10-29T17:24:09.670+07:00 [INFO] [MongoDbService] ' + trace + ' |REQUEST|' + documents[5] + '|RESPONSE|' + documents[6],
    '2026-10-29T17:24:09.703+07:00 [INFO] [KafkaService] ' + trace + ' |REQUEST|' + documents[7] + '|RESPONSE|' + documents[8] + '|CLASS|KafkaService',
    '2026-10-29T17:24:09.704+07:00 [INFO] [LoggingInterceptor] ['
  ];
  const input = lines.join("\r\n");
  for (const indent of [2, 4]) {
    let expected = input;
    const outerFirst = Array.from(new Set(documents)).sort((first, second) => second.length - first.length);
    for (const document of outerFirst) expected = expected.replaceAll(document, JSON.stringify(JSON.parse(document), null, indent));
    const loose = formatLooseText(input, indent);
    assert.equal(loose.blocks, 9);
    assert.equal(loose.text, expected);
    const strict = formatText(input, indent);
    assert.deepEqual(strict, loose);
    assert.equal(getDocuments(strict.text).length, 9);
    assert.equal(minifyText(strict.text).text, input);
    assert.deepEqual(formatText(strict.text, indent), strict);
  }
});

test("preserves a bare truncated log tag without counting it as JSON", () => {
  const input = '[INFO] BODY|{"ok":true}\r\n2026-10-29T17:24:09.704+07:00 [INFO] [LoggingInterceptor] [   ';
  const expected = '[INFO] BODY|{\n  "ok": true\n}\r\n2026-10-29T17:24:09.704+07:00 [INFO] [LoggingInterceptor] [   ';
  assert.equal(formatLooseText(input).text, expected);
  assert.equal(formatLooseText(input).blocks, 1);
  assert.equal(formatText(input).text, expected);
  assert.equal(getDocuments(expected).length, 1);
  assert.equal(minifyText(expected).text, input);
  for (const tail of ['BODY|[', 'BODY|[true', 'BODY|{"bad":', 'BODY|[1,2] [']) {
    assert.throws(() => formatText('[INFO] BODY|{}\n[INFO] ' + tail), SyntaxError);
  }
});

test("does not mistake valid boolean and null arrays for log tags", () => {
  const result = formatText("[INFO] BODY|[true]|OTHER|[false]|LAST|[null]");
  assert.equal(result.text, "[INFO] BODY|[\n  true\n]|OTHER|[\n  false\n]|LAST|[\n  null\n]");
  assert.equal(result.blocks, 3);
});

test("rejects empty, missing, malformed, truncated, and mismatched JSON", () => {
  for (const input of ["", "hello", "[INFO]", '{"a":}', 'BODY|{"a":1', 'BODY|{"a":[1}', 'BODY|{"ok":true}|HEADERS|{"bad":}']) {
    assert.throws(() => formatText(input), SyntaxError);
  }
  assert.throws(() => formatText("{}", 3), RangeError);
});

test("minifies without changing strings, large numbers, duplicate keys, or log text", () => {
  const compact = '{"id":90071992547409931234,"id":2,"rate":1.00e+3,"text":"a  b \\u0061","list":[true,null,{}]}';
  assert.equal(minifyText(formatText(compact).text).text, compact);
  const prefix = '[INFO] [!dt dt.trace_id=demo]  BODY|';
  const suffix = '\r\n[INFO] [MongoDbSe';
  const result = minifyText(prefix + formatText(compact).text + suffix);
  assert.equal(result.text, prefix + compact + suffix);
  assert.equal(result.blocks, 1);
  assert.equal(result.mode, "log");
  assert.equal(minifyText(' "a  b" ').text, '"a  b"');
  assert.throws(() => minifyText('BODY|{"bad":}'), SyntaxError);
});

test("extracts complete JSON documents and original positions from logs", () => {
  const prefix = '[INFO] [!dt dt.trace_id=demo] HEADERS|';
  const first = '{"id":90071992547409931234}';
  const second = '[true,null]';
  const input = prefix + first + '|BODY|' + second + '\n[INFO] [MongoDbSe';
  assert.deepEqual(getDocuments(input), [
    { text: first, position: prefix.length },
    { text: second, position: prefix.length + first.length + 6 }
  ]);
  assert.deepEqual(getDocuments(' "hello" '), [{ text: ' "hello" ', position: 0 }]);
  assert.throws(() => getDocuments('BODY|{}|RESPONSE|{"bad":}'), SyntaxError);
});

test("optional loose formatting handles invalid or incomplete JSON without repairing it", () => {
  const input = '[INFO] [!dt dt.trace_id=demo] BODY|{"ok":true,"items":[1,';
  const result = formatLooseText(input);
  assert.ok(result.text.startsWith('[INFO] [!dt dt.trace_id=demo] BODY|{\n'));
  assert.ok(result.text.includes('"items": [\n    1,'));
  assert.equal(formatLooseText(result.text, 0).text, input);
  assert.throws(() => formatText(input), SyntaxError);
  assert.throws(() => getDocuments(result.text), SyntaxError);
  assert.doesNotThrow(() => formatLooseText('BODY|{"items":[1}}}'));
  assert.equal(formatLooseText('plain log text').text, 'plain log text');
  assert.throws(() => formatLooseText(''), SyntaxError);
});

test("formats MongoDB shell documents while preserving types and single-quoted strings", () => {
  const input = String.raw`{data_order:{shippingDetail:{shippingPrice:NumberInt('50'),deliveryMethod:'standard delivery'},items:[{qty:NumberInt('1')}],description:'a  b [prefix] { device }'},created_at:ISODate('2026-11-03T03:05:31.586Z'),_id:ObjectId('6ae94f7bc536718665962a63'),voucherAmt:Double('NaN'),long:NumberLong('90071992547409931234'),subject:'You\'ve received your item'}`;
  for (const indent of [2, 4]) {
    const result = formatText(input, indent);
    assert.equal(result.mode, "object");
    assert.equal(result.blocks, 1);
    assert.ok(result.text.includes("deliveryMethod: 'standard delivery'"));
    assert.ok(result.text.includes("description: 'a  b [prefix] { device }'"));
    assert.ok(result.text.includes(String.raw`subject: 'You\'ve received your item'`));
    assert.ok(result.text.includes("NumberLong('90071992547409931234')"));
    assert.equal(minifyText(result.text).text, input);
    assert.deepEqual(formatText(result.text, indent), result);
    assert.deepEqual(getDocuments(result.text), [{ text: result.text, position: 0 }]);
  }
});

test("loose formatting preserves single-quoted text even in incomplete documents", () => {
  const input = String.raw`{subject:'You\'ve received your item [prefix] { }',url:'https://example.test/a:b',items:[NumberInt('1'),`;
  const result = formatLooseText(input);
  assert.ok(result.text.includes(String.raw`subject: 'You\'ve received your item [prefix] { }'`));
  assert.ok(result.text.includes("url: 'https://example.test/a:b'"));
  assert.equal(formatLooseText(result.text, 0).text, input);
});

test("supports JSON5-style data, comments, regex, and BSON constructors without rewriting values", () => {
  const input = String.raw`{/* keep [braces] { and spaces } */unquoted:'hello world',hex:0xff,fraction:.5,positive:+1,infinite:-Infinity,missing:undefined,regex:/[{} ]+/gi,decimal:NumberDecimal('1.00'),binary:BinData(0,'AA=='),date:new Date('2026-11-03'),items:[1,],}`;
  const result = formatText(input);
  assert.equal(result.mode, "object");
  assert.ok(result.text.includes("/* keep [braces] { and spaces } */"));
  assert.ok(result.text.includes("/[{} ]+/gi"));
  assert.ok(result.text.includes("new Date('2026-11-03')"));
  assert.ok(minifyText(result.text).text.includes("new Date('2026-11-03')"));
  assert.deepEqual(getTree(minifyText(result.text).text), getTree(minifyText(input).text));
  assert.equal(formatText('[1,]').mode, "object");
  assert.deepEqual(formatText(result.text), result);
  const lineComment = "{first:1,// keep this comment\nsecond:'two words'}";
  assert.ok(minifyText(lineComment).text.includes("// keep this comment\n"));
  assert.deepEqual(getTree(minifyText(lineComment).text), getTree(lineComment));
});

test("tree preserves duplicate keys, unsafe-sized numeric text, and MongoDB types", () => {
  const tree = getTree("{id:90071992547409931234,id:NumberLong('90071992547409931234'),__proto__:{ok:true},nan:Double('NaN')}");
  assert.equal(tree.entries.length, 4);
  assert.equal(tree.entries[0][1].text, "90071992547409931234");
  assert.equal(tree.entries[1][1].text, "NumberLong('90071992547409931234')");
  assert.equal(tree.entries[2][0], "__proto__");
  assert.equal(tree.entries[3][1].text, "Double('NaN')");
});

test("rejects executable expressions without calling functions or evaluating code", () => {
  globalThis.__formatterExecuted = false;
  const unsafe = [
    "{value:(globalThis.__formatterExecuted=true)}",
    "{value:(()=>{globalThis.__formatterExecuted=true})()}",
    "{get value(){return 1}}", "{[alert(1)]:1}", "{...other}",
    "{value:fetch('https://example.test')}", "{value:ObjectId(alert(1))}",
    "{value:process.exit()}", "{value:Math.random()}", "{value:`${alert(1)}`}"
  ];
  for (const input of unsafe) {
    assert.throws(() => formatText(input), SyntaxError);
    assert.throws(() => getTree(input), SyntaxError);
    assert.doesNotThrow(() => formatLooseText(input));
  }
  assert.equal(globalThis.__formatterExecuted, false);
  delete globalThis.__formatterExecuted;
});

test("preserves template string punctuation and opaque tails that cannot be tokenized", () => {
  const input = "{brace:`{`,colon:`:`,array:`[`,text:`two  words`}";
  assert.equal(minifyText(formatText(input).text).text, input);
  const incomplete = "{first:1,subject:'unfinished text [prefix] { }  ";
  const result = formatLooseText(incomplete);
  assert.ok(result.text.includes("first: 1"));
  assert.ok(result.text.endsWith("'unfinished text [prefix] { }  "));
  assert.equal(formatLooseText(result.text, 0).text, incomplete);
  const comment = "{first:1,/* unfinished comment with spaces [ ]  ";
  assert.ok(formatLooseText(comment).text.endsWith("/* unfinished comment with spaces [ ]  "));
});

test("whole-text formatting matches the reference log layout including timestamp and tags", () => {
  const headers = '{"accept":"application/json, text/plain, */*","authorization":"Bearer demo","tracestate":"fw4;1;2h04","cookie":"dtCookie=demo"}';
  const body = '{"transactionId":"demo","receiptNum":"RECEIPT-001","omniTranNo":"","receiptCompany":"AWN"}';
  const response = '{"resultCode":"20000","resultMessage":"Success","result":{"resultMessage":"Success"}}';
  const input = '2026-11-03T13:13:12.005+07:00 [INFO] [LoggingInterceptor] [!dt dt.trace_id=dc0d766788db30b8a0912b2f6e8690aa,dt.span_id=8840fffd2066aa83,dt.trace_sampled=true] |ACTION|outgoing|METHOD|post|PATH|/create-contract|HEADERS|' + headers + '|BODY|' + body + '|RESPONSE|' + response + '|DURATION|1885';
  for (const indent of [2, 4]) {
    const space = ' '.repeat(indent);
    const prefix = '2026-11-03T13: 13: 12.005+07: 00[\n' + space + 'INFO\n][\n' + space + 'LoggingInterceptor\n][\n' + space + '!dtdt.trace_id=dc0d766788db30b8a0912b2f6e8690aa,\n' + space + 'dt.span_id=8840fffd2066aa83,\n' + space + 'dt.trace_sampled=true\n]|ACTION|outgoing|METHOD|post|PATH|/create-contract|HEADERS|';
    const expected = prefix + JSON.stringify(JSON.parse(headers), null, indent) + '|BODY|' + JSON.stringify(JSON.parse(body), null, indent) + '|RESPONSE|' + JSON.stringify(JSON.parse(response), null, indent) + '|DURATION|1885';
    const result = formatWholeText(input, indent);
    assert.equal(result.text, expected);
    assert.equal(result.blocks, 3);
    assert.equal(result.mode, "log");
    assert.equal(formatWholeText(result.text, indent).text, expected);
    assert.ok(formatText(input, indent).text.startsWith('2026-11-03T13:13:12.005+07:00 [INFO] [LoggingInterceptor] [!dt '));
  }
});

test("whole-text format and minify preserve quoted data and support incomplete text", () => {
  const json = String.raw`{"text":"a  b | [ ] { } \\ \"quote\"","nested":[{},[],true,null],"id":90071992547409931234}`;
  assert.equal(formatWholeText(json, 0).text, json);
  assert.equal(formatWholeText(formatWholeText(json).text, 0).text, json);
  const object = String.raw`{subject:'You\'ve received your item [prefix] { }',value:NumberLong('90071992547409931234')}`;
  assert.equal(formatWholeText(formatWholeText(object).text, 0).text, object);
  assert.ok(formatWholeText('[INFO] BODY|{"ok":true}\n[LoggingInterceptor] [').text.endsWith('[\n  LoggingInterceptor\n]['));
  assert.doesNotThrow(() => formatWholeText('raw text {unclosed:[1,'));
  const partial = "{subject:'unfinished text  ";
  assert.ok(formatWholeText(partial).text.endsWith("'unfinished text  "));
  assert.throws(() => formatWholeText(''), SyntaxError);
  assert.throws(() => formatWholeText('{}', 3), RangeError);
});