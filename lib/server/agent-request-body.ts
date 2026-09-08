/** Limit actual incoming bytes before decoding or parsing client data. */
export async function readAgentRequestBody(request: Request, maxBytes = 4_000_000): Promise<string> {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let size = 0
  let text = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new RangeError("Agent request exceeds the 4 MB limit.")
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally { reader.releaseLock() }
}
