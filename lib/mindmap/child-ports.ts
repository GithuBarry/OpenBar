export const CHILD_PORT_PITCH = 12;
export type ChildPort = { id: string; childId: string; top: number };
export type ChildPortLayout = { ports: ChildPort[]; hitHeight: number };

export function childSourceHandleId(childId: string): string {
  return `child-${childId}`;
}

/** Stable card-local endpoints shared by curves and their preview buttons. */
export function childPortLayout(childIds: readonly string[], height: number): ChildPortLayout {
  const cardHeight = Math.max(1, height);
  const pitch = childIds.length > 1
    ? Math.min(CHILD_PORT_PITCH, Math.min(24, cardHeight / 3) / (childIds.length - 1))
    : Math.min(CHILD_PORT_PITCH, cardHeight);
  return {
    hitHeight: pitch,
    ports: childIds.map((childId, index) => ({
      id: childSourceHandleId(childId), childId,
      top: 50 + (index - (childIds.length - 1) / 2) * pitch / cardHeight * 100,
    })),
  };
}
