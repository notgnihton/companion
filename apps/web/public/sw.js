self.addEventListener("push", (event) => {
  let payload = {
    title: "Companion",
    message: "You have a new update.",
    url: "/companion/",
    deadlineId: null,
    source: null,
    priority: "medium",
    notificationId: null
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: typeof parsed.title === "string" ? parsed.title : payload.title,
        message: typeof parsed.message === "string" ? parsed.message : payload.message,
        url: typeof parsed.url === "string" ? parsed.url : payload.url,
        deadlineId: typeof parsed.deadlineId === "string" ? parsed.deadlineId : payload.deadlineId,
        source: typeof parsed.source === "string" ? parsed.source : payload.source,
        priority: typeof parsed.priority === "string" ? parsed.priority : payload.priority,
        notificationId: typeof parsed.notificationId === "string" ? parsed.notificationId : payload.notificationId
      };
    } catch {
      const text = event.data.text();
      payload.message = text || payload.message;
    }
  }

  const notificationOptions = {
    body: payload.message,
    icon: "/companion/icon.svg",
    badge: "/companion/icon.svg",
    data: {
      url: payload.url,
      deadlineId: payload.deadlineId,
      source: payload.source,
      priority: payload.priority,
      notificationId: payload.notificationId,
      notificationTitle: payload.title,
      timestamp: Date.now()
    }
  };

  // Add action buttons for overdue deadline notifications
  if (payload.deadlineId && payload.source === "assignment-tracker") {
    notificationOptions.actions = [
      { action: "complete", title: "Mark complete" },
      { action: "working", title: "Still working" }
    ];
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, notificationOptions)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  
  // Track tap interaction
  const data = event.notification.data || {};
  if (data.notificationId && data.source && data.priority && data.notificationTitle) {
    const timeToInteractionMs = data.timestamp ? Date.now() - data.timestamp : undefined;
    
    event.waitUntil(
      fetch("/companion/api/notification-interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notificationId: data.notificationId,
          notificationTitle: data.notificationTitle,
          notificationSource: data.source,
          notificationPriority: data.priority,
          interactionType: "tap",
          timeToInteractionMs
        })
      }).catch(() => {
        // Silently fail if tracking fails
      })
    );
  }

  const targetUrl =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/companion/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener("notificationactionclick", (event) => {
  event.notification.close();
  
  const deadlineId = event.notification.data?.deadlineId;
  
  if (!deadlineId) {
    return;
  }

  const completed = event.action === "complete";
  const actionText = completed ? "completed" : "in progress";

  event.waitUntil(
    fetch(`/companion/api/deadlines/${deadlineId}/confirm-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ completed })
    })
      .then((response) => {
        if (response.ok) {
          return self.registration.showNotification("Status updated", {
            body: `Deadline marked as ${actionText}`,
            icon: "/companion/icon.svg",
            badge: "/companion/icon.svg"
          });
        } else {
          return self.registration.showNotification("Update failed", {
            body: "Could not update deadline status. Please try again.",
            icon: "/companion/icon.svg",
            badge: "/companion/icon.svg"
          });
        }
      })
      .catch(() => {
        return self.registration.showNotification("Update failed", {
          body: "Could not update deadline status. Please try again.",
          icon: "/companion/icon.svg",
          badge: "/companion/icon.svg"
        });
      })
  );
});
