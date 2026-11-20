import { AGENT_GUIDANCE } from "@/lib/research/agent-guidance";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentConnectionAddress } from "@/components/agent-connection-address";

export const metadata: Metadata = { title: "OpenBar agent instructions", description: "Start using OpenBar with the interface, browser WebMCP, or authenticated HTTP MCP." };

export default function AgentAccessPage() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl space-y-8 px-6 py-10 text-ink">
      <Link href="/" className="text-sm text-accent">← OpenBar workspace</Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">OpenBar agent instructions</h1>
        <p className="font-medium">{AGENT_GUIDANCE}</p>
        <p className="text-muted">OpenBar supports people, browser agents, and headless clients. The Tools button in each project opens the current browser-tool status and this guide.</p>
        <p className="text-muted">For instructions specific to a private project, open <code>/p/&lt;project&gt;/instructions</code> on this workspace. Use the project name from the link you followed.</p>
      </header>
      <section className="space-y-3" aria-labelledby="headless-help">
        <h2 id="headless-help" className="text-xl font-semibold">Connect a coding or headless agent (Recommended)</h2>
        <p>Prefer native MCP or REST over driving the user’s browser tabs. Native MCP contributes cleanly through revision checks without navigating or taking over the human’s open browser session.</p>
        <p>Copy this address into a Streamable HTTP MCP connection and supply <code>Authorization: Bearer &lt;access token&gt;</code> using the server’s configured <code>OPENBARRY_ACCESS_TOKEN</code> (or its allowed Cloudflare Access identity). <strong>If you do not have the token or MCP connection yet, ask the human for the token</strong> instead of falling back to browser automation unless they explicitly ask you to use the browser.</p>
        <AgentConnectionAddress />
        <ol className="list-decimal space-y-2 pl-5">
          <li>Connect using a current MCP SDK. The endpoint handles each HTTP request independently and also supports 2025 clients through the SDK.</li>
          <li>Call <code>tools/list</code> for the current names, descriptions, and input schemas.</li>
          <li>Call <code>get_project_state</code> with <code>{'{"project":"<slug>"}'}</code> for project context and available instruction and skill metadata. The slug is the segment after <code>/p/</code> in a project URL.</li>
          <li>Use the returned map IDs, revisions, and file hashes in subsequent operations. Inspect local-save and remote-sync results separately.</li>
        </ol>
        <p>For Git conflicts, inspect the <code>sync</code> field in project state. Use <code>sync_project</code> with <code>review_pull</code> to receive the base, local, and Git contents for each conflicting file. Resolve whole files and call <code>apply_pull</code> with the returned token. Changes arriving during review require a fresh review.</p>
        <p>For mutation tools that accept <code>requestId</code>, supply a unique stable ID and reuse it for retries. HTTP MCP operates saved repository state without interrupting active browser editing.</p>
        <p>REST clients can read <code>/api/tools</code> and send JSON arguments to <code>/api/tools/&lt;name&gt;</code> with the same bearer token. <Link href="/openapi.json" className="text-accent underline">OpenAPI discovery</Link> describes every endpoint. MCP and REST results use <code>{'{"ok":true,"value":...}'}</code> with revision and save details.</p>
        <p>Stdio clients can launch <code>node scripts/mcp-stdio.mjs</code> with <code>OPENBARRY_URL</code> and <code>OPENBARRY_ACCESS_TOKEN</code> in their environment. Tailscale addresses require access to your private network. External browser origins require configuration in <code>OPENBARRY_AGENT_ORIGINS</code>.</p>
        <p><Link href="/llms.txt" className="text-accent underline">Optional agent index</Link>{" | "}<Link href="/llms-deployment.txt" className="text-accent underline">Deployment and connection reference</Link></p>
      </section>
      <section className="space-y-3" aria-labelledby="inbox-help">
        <h2 id="inbox-help" className="text-xl font-semibold">Talk to your agent from a mindmap</h2>
        <p>Write <code>@agent</code> on a mindmap card. Use <code>@stat</code> for a fast tracked request displayed as <strong>agent STAT</strong>. Fast tracked requests appear first and use the same reply and acknowledgement flow. Then tell your connected agent <strong>tick</strong>, <strong>check updates</strong>, <strong>check inbox</strong>, or <strong>sync</strong>. It calls <code>check_inbox</code>, reads the card, replies there, and marks the exact notification handled with <code>acknowledge_inbox</code>.</p>
        <p>Fresh agents also check the inbox after <code>get_project_state</code> at the start of each session, including when earlier chat context is unavailable. A request to sync Git or Overleaf checks the inbox first, then performs the requested synchronization.</p>
        <p>OpenBar also prefixes pending requests to tool results. Repeated IDs identify the same request. Editing the request creates a fresh notification. The Tools panel shows pending and handled requests and lets you reopen them. Your original request and paper TODO completion stay available.</p>
      </section>
      <section className="space-y-3" aria-labelledby="browser-help">
        <h2 id="browser-help" className="text-xl font-semibold">Connect a browser-only agent</h2>
        <p>Use browser WebMCP only when running inside a browser-only agent integration or when the human asks for live visual verification. Do not open or drive browser tabs just to avoid asking for the MCP bearer token.</p>
        <p>Open the project over HTTPS or localhost in a browser integration that supports <code>document.modelContext</code>. OpenBar registers WebMCP tools for the active page. Open <strong>Tools</strong> to inspect the registered tool names and connection diagnostics.</p>
        <p>Standard browser automation can call <code>window.openbarAgent.listTools()</code> and <code>await window.openbarAgent.executeTool(name, args)</code>. These tools use the live page and editor. After navigation, call <code>await window.openbarAgent.waitForNavigation(href)</code> before using destination tools.</p>
        <p>Discover tools through your browser integration. <code>get_project_state</code> returns project context and instruction and skill metadata. Load relevant detail through the tools as needed. The active browser page supplies the project identity.</p>
        <p>Use the labeled interface for visual verification or a capability missing from the tool catalog. Prefer WebMCP for supported operations.</p>
      </section>
      <section className="space-y-3" aria-labelledby="interface-help">
        <h2 id="interface-help" className="text-xl font-semibold">Use the interface</h2>
        <p>Select a mindmap card and open <strong>Card</strong> for the right-hand inspector. Double-click the card, or select it and press <kbd>E</kbd>, to edit. Select text and use Bold or Italic above the card. Clicking outside saves. Escape cancels the draft.</p>
        <p>Ordinary cards support plain text, Markdown, TeX, and static HTML through the inspector’s Content format setting. Paper TODO text and completion are shared with the manuscript. Their formatting uses TeX.</p>
        <p>The keyboard button shows navigation and editing shortcuts. Controls have accessible names, so browser automation can use role and label selectors.</p>
      </section>
    </main>
  );
}
