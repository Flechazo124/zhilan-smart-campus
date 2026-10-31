import { useEffect, useRef, useState } from "react";
import type { User } from "./types";

export interface RealtimeEvent {
  id: string;
  type: "assignment" | "attendance" | "announcement" | "course";
  action: string;
  actorId: string;
  actorName: string;
  emittedAt: string;
  title?: string;
  courseId?: string;
  courseName?: string;
  studentId?: string;
  studentName?: string;
  assignmentId?: string;
  sessionId?: string;
  announcementId?: string;
  status?: string;
}

export function useRealtime(user: User | null, onEvent: (event: RealtimeEvent) => void) {
  const [realtimeVersion, setRealtimeVersion] = useState(0);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!user) {
      setRealtimeConnected(false);
      setRealtimeVersion(0);
      return;
    }

    const source = new EventSource("/api/events");
    const handleUpdate = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;
        setRealtimeVersion((current) => current + 1);
        onEventRef.current(event);
      } catch {
        // Ignore malformed events and keep the stream alive.
      }
    };

    source.onopen = () => setRealtimeConnected(true);
    source.onerror = () => setRealtimeConnected(false);
    source.addEventListener("campus-update", handleUpdate as EventListener);

    return () => {
      source.removeEventListener("campus-update", handleUpdate as EventListener);
      source.close();
      setRealtimeConnected(false);
    };
  }, [user?.id]);

  return { realtimeVersion, realtimeConnected };
}
