import Workspace from "@/components/Workspace";
import { projects } from "@/lib/demo";
import { notFound } from "next/navigation";
export function generateStaticParams() {
  return projects.map(({ id }) => ({ id }));
}
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!projects.some((p) => p.id === id)) notFound();
  return <Workspace initialProjectId={id} />;
}
