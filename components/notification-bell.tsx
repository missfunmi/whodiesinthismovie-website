"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

type NotificationMovie = {
  tmdbId: number;
  title: string;
  createdAt: string;
};

type SeenNotification = {
  id: number;
  addedAt: number;
};

const POLL_INTERVAL_MS = 60_000; // 60 seconds
// Longer than the poll API's 24h window intentionally — prevents a race where
// a movie could re-appear as "unread" if its localStorage entry were pruned
// right as it falls off the 24h API response boundary.
const NEW_MOVIES_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationMovie[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false); // Prevents badge flicker
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Helper to manage localStorage with pruning and legacy support
  const getProcessedSeenIds = useCallback((): number[] => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("seenNotifications");
      if (!stored) return [];

      const parsed = JSON.parse(stored);
      const newMoviesLimit = Date.now() - NEW_MOVIES_LIMIT_MS;

      // Resilience: Handle legacy array of numbers vs new array of objects
      if (Array.isArray(parsed) && typeof parsed[0] === "number") {
        const migrated = parsed.map((id) => ({ id, addedAt: Date.now() }));
        localStorage.setItem("seenNotifications", JSON.stringify(migrated));
        return parsed;
      }

      const validEntries: SeenNotification[] = parsed.filter(
        (item: any) => item.addedAt && item.addedAt > newMoviesLimit,
      );

      if (validEntries.length !== parsed.length) {
        localStorage.setItem("seenNotifications", JSON.stringify(validEntries));
      }

      return validEntries.map((item) => item.id);
    } catch (e) {
      return [];
    }
  }, []);

  const saveSeenId = useCallback((tmdbId: number) => {
    try {
      const stored = localStorage.getItem("seenNotifications");
      const current: SeenNotification[] = stored ? JSON.parse(stored) : [];

      if (!current.some((item) => item.id === tmdbId)) {
        const updated = [...current, { id: tmdbId, addedAt: Date.now() }];
        localStorage.setItem("seenNotifications", JSON.stringify(updated));
      }
    } catch (e) {
      // Silent catch for potential storage quota issues
    }
  }, []);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/notifications/poll", { cache: "no-store" });
        if (!res.ok) return;

        const movies: NotificationMovie[] = await res.json();
        const seenIds = getProcessedSeenIds();

        const unread = movies.filter((m) => !seenIds.includes(m.tmdbId));
        setNotifications(unread);
      } catch (error) {
        // Silent failure as per SPEC 7.8
      } finally {
        setIsInitialized(true);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [getProcessedSeenIds]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAsRead = (tmdbId: number) => {
    saveSeenId(tmdbId);
    setNotifications((prev) => prev.filter((n) => n.tmdbId !== tmdbId));
  };

  const handleNotificationClick = (tmdbId: number) => {
    markAsRead(tmdbId);
    setIsOpen(false);
    router.push(`/movie/${tmdbId}`);
  };

  const handleMarkAllRead = () => {
    notifications.forEach((n) => saveSeenId(n.tmdbId));
    setNotifications([]);
    setIsOpen(false);
  };

  const displayNotifications = notifications.slice(0, 5);

  return (
    <div className="fixed top-4 right-4 z-50" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-12 h-12 rounded-full bg-white shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center text-gray-700"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Bell className="w-6 h-6" />
        {isInitialized && notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center animate-in fade-in zoom-in duration-300">
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-200 animate-in slide-in-from-top-2 duration-200"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") setIsOpen(false);
          }}
        >
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h3 className="font-bold text-gray-900">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="py-2">
            {displayNotifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No new notifications
              </div>
            ) : (
              displayNotifications.map((movie) => (
                <button
                  key={movie.tmdbId}
                  onClick={() => handleNotificationClick(movie.tmdbId)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
                  role="menuitem"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 line-clamp-1">
                        {movie.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                          New!
                        </span>
                        <span className="text-xs text-gray-500">
                          Just added
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
