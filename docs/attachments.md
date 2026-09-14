# Files in conversations

Current behavior, September 7, 2026.

Use **Attach files**, drag files into the conversation, or paste a screenshot. Harbor saves a private local copy before sending a reference to the selected agent. Uploaded files appear as chips before sending and downloadable filenames in the message. Drafts are stored per task.

Originals and prepared content are stored in `~/.openmausbot/attachments/`. Attaching a file does not upload it to an AI service. When you send the message, the selected provider receives extracted previews and content the agent requests. Jinx receives that content through her existing private Mini connection. Local-model agents use local extraction and transcription with no cloud fallback.

| Format | Available content |
| --- | --- |
| DOCX | Text and table cells; embedded pictures, page layout and tracked-change history are not interpreted |
| DOC, RTF | Text through macOS textutil; on other platforms, convert to DOCX |
| XLS, XLSX, CSV | Sheet names, cell addresses, values, formulas and cached results; formulas are not recalculated and charts are not extracted |
| PDF | Text by page; rendered page images for scans, diagrams and layout |
| PNG, JPG/JPEG, WebP, GIF | Normalized image for a vision-capable model; GIF uses a still frame |
| MP3, M4A, WAV, OGG, FLAC, AAC | Local speech transcript; not general sound/music analysis or speaker identification |
| MP4, MOV, WebM, MKV | Local speech transcript and still frames at requested timestamps; not continuous motion analysis |
| TXT, MD, JSON | Text sections |

The first ten minutes of speech are prepared automatically. Longer recordings are clearly marked, and the agent can request additional segments. Transcripts can contain recognition errors. Text-only local agents can read transcripts and extracted document text, but cannot inspect scans, pictures or frames. Local vision is enabled only when the local server explicitly reports vision support for the selected model through the currently supported `/api/v1/models` capability response; this has been verified with LM Studio. Cloud models must also support vision to inspect visual content.

## Limits and runtime

Up to 12 attachments per message. Media duration is limited to four hours. Documents and images: 20 MB each. Audio/video: 100 MB each. PDFs: 500 pages; extracted text: 2 million characters; spreadsheets: 100,000 populated cells. A prompt includes a bounded preview, with the remainder available through `harbor_read_attachment`. No document macros or spreadsheet formulas are executed. Reads are limited to attachments explicitly referenced by user messages on the active conversation branch. Different tasks require attaching the file again.

Document parsing runs in bounded worker threads. Local CLI agents additionally receive copies in their permitted working directory and an attachment reader through the existing MCP integration. Original files are never edited by extraction. Removing a draft chip does not delete the locally stored original.

Media requires FFmpeg/ffprobe and whisper-cli. The local speech model is `~/.openmausbot/media-models/ggml-base.bin`. Missing tools produce an explicit availability message. These media dependencies are configured on Laura's current Mac; a fresh installation on another machine needs its own setup.

Readers use [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/), [Mammoth](https://github.com/mwilliamson/mammoth.js), [PDF.js](https://github.com/mozilla/pdf.js), and [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Image originals are normalized locally before vision requests. Long Jinx reviews discard older image payloads from subsequent requests when needed to fit the private bridge limit; files remain available to read again.

## Provider and packaging boundaries

Direct OpenRouter, local-model and Jinx turns receive the attachment reader;
API-model rooms also have attachment reading. The separate experimental
OpenRouter Local VM route does not mount the general attachment tools. Native
CLI/ACP integration depends on the selected engine's supported MCP path.

The current Mac source runtime has been exercised with synthetic documents,
spreadsheets, PDF text and scanned pages, images, speech recordings and video
frames. The new parser libraries, native image/canvas dependencies, external media
tools and speech-model files still need verification inside a fresh-machine
package. A production build alone does not prove that installation path. See
[deployment](deployment.md) and the [current handoff](plans/current-handoff.md).
