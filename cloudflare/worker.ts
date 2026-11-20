import { Container } from "@cloudflare/containers";

export class OpenBarContainer extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "2h";
  envVars = {
    NODE_ENV: "production",
    HOSTNAME: "0.0.0.0",
    PORT: "3000",
    OPENBAR_CONTENT: "/data/openbar",
    OPENBAR_PUBLIC_DEMO: "1",
    OPENBAR_DEMO_SLUGS: "command-v,noveltybench",
    OPENBAR_DEMO_FIXTURE: "/opt/openbar-seed/published-papers",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.OPENBAR_CONTAINER.getByName("public-demo").fetch(request);
  },
} satisfies ExportedHandler<Env>;
