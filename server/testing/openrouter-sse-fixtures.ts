/** Recorded-shape OpenRouter SSE fixtures. The transport tests deliberately
 * re-chunk these bytes so fixture line boundaries never imply network chunk
 * boundaries. */
export const fragmentedToolCallSse = [
  'data: {"choices":[{"delta":{"content":"Checking café "}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_weather","type":"function","function":{"name":"get_","arguments":"{\\"city\\":\\"Mon"}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":null,"type":null,"function":{"name":"weather","arguments":"tréal\\",\\"unit\\":\\""}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":null,"function":{"name":null,"arguments":"c\\"}"}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":17,"completion_tokens":8}}',
  "data: [DONE]",
  "",
].join("\n");

export const interleavedToolCallsSse = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_math","type":"function","function":{"name":"cal_","arguments":"{\\"right\\":"}},{"index":0,"id":"call_lookup","type":"function","function":{"name":"loo","arguments":"{\\"query\\":\\"har"}}]}}]}',
  'data: {"choices":[{"delta":{"content":"I will check both. ","tool_calls":[{"index":0,"function":{"name":"kup","arguments":"bor\\"}"}},{"index":1,"function":{"name":"culator","arguments":"2}"}}]}}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
  "",
].join("\n");

export const sequentialToolCallsSse = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_first","type":"function","function":{"name":"first","arguments":"{}"}}]}}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_second","type":"function","function":{"name":"second","arguments":"{\\"ok\\":true}"}}]}}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
  "",
].join("\n");
