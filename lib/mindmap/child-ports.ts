export const CHILD_PORT_PITCH = 28;
export const GROUPED_CHILD_PORT_ID = "children";

export type ChildPort = { id: string; childId?: string; top: number };
export type ChildPortLayout = { grouped: boolean; ports: ChildPort[] };

export function childSourceHandleId(childId: string): string {
  return `child-${childId}`;
}

/** Stable card-local endpoints shared by curves and their preview buttons. */
export function childPortLayout(childIds: readonly string[], height: number): ChildPortLayout {
  if (!childIds.length) return { grouped: false, ports: [] };
  if (childIds.length > 8 || childIds.length * CHILD_PORT_PITCH > height - 12) {
    return { grouped: true, ports: [{ id: GROUPED_CHILD_PORT_ID, top: 50 }] };
  }
  return {
    grouped: false,
    ports: childIds.map((childId, index) => ({
      id: childSourceHandleId(childId), childId,
      top: 50 + (index - (childIds.length - 1) / 2) * CHILD_PORT_PITCH / height * 100,
    })),
  };
}
