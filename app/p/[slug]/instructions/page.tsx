import Link from "next/link";
import { platformWishlistAvailable } from "@/lib/research/platform-wishlist";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { ProjectInstructionsClient } from "@/features/instructions/project-instructions-client";
import {
  discoverSkillsInDir,
  discoverWorkspaceSkills,
  findAgentsMd,
  hashText,
  workspaceRoot,
} from "@/lib/research/project-skills";
import { getProjectMetadata, projectContentDir } from "@/lib/store";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function InstructionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  if (isPublicDemoMode()) notFound();
  const project = getProjectMetadata(slug);
  if (!project) notFound();
  const root = projectContentDir(slug);
  const agents = findAgentsMd(root);
  const workspaceAgents = findAgentsMd(workspaceRoot());

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle="Project and workspace instructions"
        location="Instructions"
        project={project}
        readOnlyProject={isPublicDemoMode()}
        icon={<ScrollText size={18} />}
        actions={platformWishlistAvailable() && <Link className="p-button p-button-borderless" href="/wishlist">Platform wishlist</Link>}
      />
      <div className="mx-auto max-w-6xl p-6">
        <ProjectInstructionsClient
          slug={slug}
          agentsPath={agents?.path || "AGENTS.md"}
          agentsBody={agents?.body || ""}
          agentsHash={agents ? hashText(agents.body) : hashText("")}
          skills={discoverSkillsInDir(root)}
          workspaceAgentsPath={workspaceAgents?.path || "AGENTS.md"}
          workspaceAgentsBody={workspaceAgents?.body || ""}
          workspaceAgentsHash={workspaceAgents ? hashText(workspaceAgents.body) : hashText("")}
          workspaceSkills={discoverWorkspaceSkills()}
        />
      </div>
    </>
  );
}
