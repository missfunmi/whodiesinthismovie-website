"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

type NotificationMovie = {
  tmdbId: number;
  title: string;
  createdAt: string;
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationMovie[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Load seen notifications from localStorage
  const getSeenIds = useCallback((): number[] => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("seenNotifications");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error("Failed to parse seenNotifications", e);
      return [];
    }
  }, []);

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await fetch("/api/notifications/poll");
        if (!res.ok) return;

        const movies: NotificationMovie[] = await res.json();
        const seenIds = getSeenIds();

        // Filter out movies we've already seen
        const unread = movies.filter((m) => !seenIds.includes(m.tmdbId));
        setNotifications(unread);
      } catch (error) {
        console.error("Error polling notifications:", error);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // Poll every 60s
    return () => clearInterval(interval);
  }, [getSeenIds]);

  // Click outside to close
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
    const seenIds = getSeenIds();
    if (!seenIds.includes(tmdbId)) {
      const newSeenIds = [...seenIds, tmdbId];
      localStorage.setItem("seenNotifications", JSON.stringify(newSeenIds));
    }

    // Update local state immediately
    setNotifications((prev) => prev.filter((n) => n.tmdbId !== tmdbId));
  };

  const handleNotificationClick = (tmdbId: number) => {
    markAsRead(tmdbId);
    setIsOpen(false);
    router.push(`/movie/${tmdbId}`);
  };

  const handleMarkAllRead = () => {
    const seenIds = getSeenIds();
    const newIds = notifications.map((n) => n.tmdbId);
    const uniqueIds = Array.from(new Set([...seenIds, ...newIds]));

    localStorage.setItem("seenNotifications", JSON.stringify(uniqueIds));
    setNotifications([]);
    setIsOpen(false);
  };

  // Only show last 5
  const displayNotifications = notifications.slice(0, 5);

  return (
    <div className="fixed top-4 right-4 z-50" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-12 h-12 rounded-full bg-white shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center text-gray-700"
        aria-label="Notifications"
      >
        <Bell className="w-6 h-6" />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center animate-in fade-in zoom-in duration-300">
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-2xl border border-gray-200 animate-in slide-in-from-top-2 duration-200">
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
                <div
                  key={movie.tmdbId}
                  onClick={() => handleNotificationClick(movie.tmdbId)}
                  className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
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
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
