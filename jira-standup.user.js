// ==UserScript==
// @name         JIRA Stand Up
// @namespace    https://www.fusan.live
// @version      0.2.0
// @description  Intrigate Stand Up with JIRA
// @author       Md Fuad Hasan
// @match        https://auxosolutions.atlassian.net/*
// @connect      allgentech.io
// @connect      auxosolutions.atlassian.net
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-standup.user.js
// @downloadURL  https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-standup.user.js
// ==/UserScript==

(function () {
  "use strict";

  // Default values for settings
  const DEFAULT_SETTINGS = {
    currentUser: "",
    teamName: "",
    apiKey: "",
    savedBoards: [],
    boardConfigs: {},
    savedTickets: [],
    storyPointsFields: {},
    savedProjects: [],
    boardToProjectMap: {},
    AgtProjectNameMapping: {},
  };

  const INJECTION_POINTS = {
    YOUR_WORK_TABS: {
      selector: '[id^="your-work-page-tabs-"][id$="-tab"]',
      type: "list",
      getTicketId: (element) => {
        const link = element.querySelector('a[href*="/browse/"]');
        if (!link) return null;
        const matches = link.href.match(/\/browse\/([A-Z]+-\d+)/);
        return matches ? matches[1] : null;
      },
    },
    TICKET_DETAILS: {
      containerSelector:
        "#issue\\.views\\.issue-details\\.issue-layout\\.container-right",
      targetSelector:
        '[data-testid="issue.views.issue-base.context.status-and-approvals-wrapper.status-and-approval"]',
      breadcrumbSelector:
        '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]',
      type: "status",
      getTicketId: (container) => {
        const breadcrumb = document.querySelector(
          INJECTION_POINTS.TICKET_DETAILS.breadcrumbSelector
        );
        if (!breadcrumb) return null;

        const matches = breadcrumb.href.match(/\/browse\/([A-Z]+-\d+)/);
        return matches ? matches[1] : null;
      },
    },
  };

  let settings = null;

  function mergeTickets(savedTickets, fetchedTickets) {
    const mergedTickets = [...savedTickets]; // Start with existing saved tickets
    const savedTicketIds = new Set(savedTickets.map((t) => t.id));

    fetchedTickets.forEach((fetchedTicket) => {
      // Skip if ticket already exists in savedTickets
      if (savedTicketIds.has(fetchedTicket.name)) {
        console.log(`Skipping existing ticket: ${fetchedTicket.name}`);
        return;
      }

      // Convert the fetched ticket to match our format
      const ticket = {
        id: fetchedTicket.name,
        name: fetchedTicket.story || "",
        storyPoints: fetchedTicket.storyPoints || 0,
        status: fetchedTicket.status,
        story: fetchedTicket.story || "",
        projectName: fetchedTicket.projectName,
        ticketType: fetchedTicket.ticketType,
        lastUpdate: new Date(fetchedTicket.updatedAt),
      };

      console.log(`Adding new ticket: ${ticket.id}`);
      mergedTickets.push(ticket);
    });

    return mergedTickets;
  }

  // API Functions

  async function fetchBoards() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://auxosolutions.atlassian.net/rest/agile/1.0/board",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-AUSERNAME":
            document.querySelector('meta[name="ajs-remote-user"]')?.content ||
            "",
        },
        withCredentials: true,
        onload: function (response) {
          try {
            if (response.status !== 200)
              throw new Error(
                `HTTP ${response.status}: ${response.statusText}`
              );

            const data = JSON.parse(response.responseText);

            // Extract unique project names and create board to project mapping
            const projectNames = new Set();
            const boardToProjectMap = {};

            data.values.forEach((board) => {
              if (board.location && board.location.projectName) {
                projectNames.add(board.location.projectName);
                boardToProjectMap[board.name] = board.location.projectName;
              }
            });

            // Update settings with unique project names and mapping
            settings.savedProjects = Array.from(projectNames);
            settings.boardToProjectMap = boardToProjectMap;

            saveSettings(settings);

            resolve(data.values);
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

  async function fetchBoardConfig(boardId) {
    if (!boardId) throw new Error("Board ID is required");

    const url = `https://auxosolutions.atlassian.net/rest/agile/1.0/board/${boardId}/configuration`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-AUSERNAME":
            document.querySelector('meta[name="ajs-remote-user"]')?.content ||
            "",
        },
        withCredentials: true,
        onload: function (response) {
          try {
            if (response.status === 403) throw new Error("Permission denied");
            if (response.status === 404)
              throw new Error("Board configuration not found");
            if (response.status !== 200)
              throw new Error(`Server returned ${response.status}`);

            const data = JSON.parse(response.responseText);
            if (!data?.columnConfig?.columns)
              throw new Error("Invalid board configuration format");

            console.log(
              `[Board ${boardId}] Checking estimation configuration:`,
              data.estimation
            );

            // Only set story points field if it doesn't exist or is empty
            if (
              !settings.storyPointsFields[boardId] ||
              settings.storyPointsFields[boardId] === ""
            ) {
              if (
                data.estimation?.type === "field" &&
                data.estimation.field?.displayName
                  ?.toLowerCase()
                  .includes("story point")
              ) {
                console.log(`[Board ${boardId}] Found story points field:`, {
                  fieldId: data.estimation.field.fieldId,
                  displayName: data.estimation.field.displayName,
                  existing: settings.storyPointsFields[boardId],
                });
                settings.storyPointsFields[boardId] =
                  data.estimation.field.fieldId;
                saveSettings(settings);
              } else {
                console.log(
                  `[Board ${boardId}] No story points field found in estimation config`
                );
              }
            } else {
              console.log(
                `[Board ${boardId}] Using existing story points field:`,
                settings.storyPointsFields[boardId]
              );
            }

            resolve(data);
          } catch (error) {
            reject(error);
          }
        },
        onerror: (error) => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Request timed out")),
      });
    });
  }

  async function fetchIncompleteTickets() {
    const today = new Date();
    const estDate = new Date(
      today.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const dateStr = estDate.toISOString().split("T")[0];

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://allgentech.io/api/employee/incomplete-tickets?date=${dateStr}`,
        headers: {
          Accept: "application/json",
          "x-api-key": settings.apiKey || "",
        },
        onload: function (response) {
          try {
            if (response.status === 200) {
              const data = JSON.parse(response.responseText);
              resolve(data);
            } else {
              reject(
                new Error(`HTTP ${response.status}: ${response.statusText}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

  // Helper function to find board config for a ticket
  function findBoardConfigForTicket(ticket) {
    // Find all boards that match the project name
    const matchingBoards = settings.savedBoards.filter((board) => {
      const boardProjectName = settings.boardToProjectMap[board.name];
      return ticket.projectName === boardProjectName;
    });

    if (!matchingBoards.length) return null;

    // If only one board, return its config
    if (matchingBoards.length === 1) {
      return settings.boardConfigs[matchingBoards[0].id];
    }

    // Merge configs from all matching boards
    const mergedConfig = {
      inProgress: [],
      inQA: [],
      done: [],
      cancelled: [],
    };

    matchingBoards.forEach((board) => {
      const boardConfig = settings.boardConfigs[board.id];
      if (!boardConfig) return;

      // Merge each status category
      Object.keys(mergedConfig).forEach((category) => {
        if (boardConfig[category]) {
          mergedConfig[category] = [
            ...new Set([...mergedConfig[category], ...boardConfig[category]]),
          ];
        }
      });
    });

    // Only return merged config if it has any statuses
    const hasStatuses = Object.values(mergedConfig).some(
      (arr) => arr.length > 0
    );
    return hasStatuses ? mergedConfig : null;
  }

  // Helper function to map ticket status based on board config
  function mapTicketStatus(currentStatus, boardConfig) {
    // Check each category (inProgress, inQA, done, cancelled)
    for (const [category, columns] of Object.entries(boardConfig)) {
      if (columns.includes(currentStatus)) {
        // Map to standardized status names
        switch (category) {
          case "inProgress":
            return "In Progress";
          case "inQA":
            return "In QA";
          case "done":
            return "Done";
          case "cancelled":
            return "Cancelled";
          default:
            return currentStatus;
        }
      }
    }

    // If no mapping found, return original status
    return currentStatus;
  }

  async function updateTicketStatus(ticketId, updateData) {
    console.log("Updating ticket:", ticketId, updateData);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "PATCH",
        url: `https://allgentech.io/api/employee/tickets/${ticketId}`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey || "",
        },
        data: JSON.stringify(updateData),
        onload: function (response) {
          if (response.status === 200) {
            resolve(JSON.parse(response.responseText));
          } else {
            reject(
              new Error(`HTTP ${response.status}: ${response.statusText}`)
            );
          }
        },
        onerror: reject,
      });
    });
  }

  async function checkDuplicateTicket(ticketName) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://allgentech.io/api/employee/tickets/check-duplicate?ticketName=${encodeURIComponent(
          ticketName
        )}`,
        headers: {
          Accept: "application/json",
          "x-api-key": settings.apiKey || "",
        },
        onload: function (response) {
          try {
            if (response.status === 200) {
              const data = JSON.parse(response.responseText);
              resolve(data.duplicate);
            } else {
              reject(
                new Error(`HTTP ${response.status}: ${response.statusText}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

  async function createNewTicket(ticketData) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `https://allgentech.io/api/employee/tickets`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey || "",
        },
        data: JSON.stringify(ticketData),
        onload: function (response) {
          try {
            if (response.status === 200 || response.status === 201) {
              const data = JSON.parse(response.responseText);
              resolve(data);
            } else {
              reject(
                new Error(`HTTP ${response.status}: ${response.statusText}`)
              );
            }
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

  // Add this function near other ticket management functions
  async function pushTicketUpdates() {
    try {
      // First fetch current tickets from API
      const data = await fetchIncompleteTickets();
      const fetchedTickets = data.tickets;

      // Create maps for easy lookup
      const fetchedTicketsMap = new Map(fetchedTickets.map((t) => [t.name, t]));
      const savedTicketsMap = new Map(
        settings.savedTickets.map((t) => [t.id, t])
      );

      // Find tickets that need updating
      const updatesNeeded = [];

      // Tickets that exist in both systems that need updating
      fetchedTickets.forEach((fetchedTicket) => {
        const savedTicket = savedTicketsMap.get(fetchedTicket.name);
        if (!savedTicket) return;

        // Find board config for this ticket
        const boardConfig = findBoardConfigForTicket(savedTicket);

        // Map both statuses
        const mappedSavedStatus = boardConfig
          ? mapTicketStatus(savedTicket.status, boardConfig)
          : savedTicket.status;

        const mappedFetchedStatus = boardConfig
          ? mapTicketStatus(fetchedTicket.status, boardConfig)
          : fetchedTicket.status;

        // Compare mapped statuses
        if (mappedSavedStatus !== mappedFetchedStatus) {
          updatesNeeded.push({
            fetchedId: fetchedTicket._id,
            savedTicket: savedTicket,
            fetchedTicket: fetchedTicket,
            mappedStatus: mappedSavedStatus,
          });
        }
      });

      // Find tickets that exist in JIRA but not in the AGT system
      const ticketsToCreate = [];
      for (const savedTicket of settings.savedTickets) {
        if (!fetchedTicketsMap.has(savedTicket.id)) {
          // This ticket exists in JIRA but not in AGT system
          // Check if it's a duplicate before adding
          ticketsToCreate.push(savedTicket);
        }
      }

      console.log(
        `Found ${updatesNeeded.length} tickets that need status updates and ${ticketsToCreate.length} tickets to create`
      );

      // Process updates sequentially
      const results = {
        updated: [],
        created: [],
        failed: [],
      };
      const completedTicketIds = []; // Track completed ticket IDs

      // First, handle updates to existing tickets
      for (const update of updatesNeeded) {
        try {
          // Get mapped project name from settings
          const mappedProjectName =
            settings.AgtProjectNameMapping[update.savedTicket.projectName] ||
            update.savedTicket.projectName;

          const today = new Date();
          const estDate = new Date(
            today.toLocaleString("en-US", { timeZone: "America/New_York" })
          );
          const dateStr = estDate.toISOString().split("T")[0];

          const updateData = {
            name: update.savedTicket.id,
            status: update.mappedStatus,
            storyPoints: update.savedTicket.storyPoints || 0,
            projectName: mappedProjectName,
            ticketType: update.savedTicket.ticketType,
            story: update.savedTicket.name || "",
            updatedAt: dateStr,
          };

          console.log(
            `Updating ticket ${update.fetchedId} status to: ${updateData.status}`
          );
          console.log(
            `Project mapping: ${update.savedTicket.projectName} → ${mappedProjectName}`
          );

          const result = await updateTicketStatus(update.fetchedId, updateData);

          // If the update was successful and the status is "Done", track for removal
          if (updateData.status === "Done") {
            completedTicketIds.push(update.savedTicket.id);
          }

          results.updated.push({
            ticketId: update.savedTicket.id,
            success: true,
            oldStatus: update.fetchedTicket.status,
            newStatus: updateData.status,
            projectName: mappedProjectName,
            updatedAt: dateStr,
          });
        } catch (error) {
          console.error(
            `Failed to update ticket ${update.savedTicket.id}:`,
            error
          );
          results.failed.push({
            ticketId: update.savedTicket.id,
            action: "update",
            success: false,
            error: error.message,
          });
        }
      }

      // Then, create new tickets if they don't already exist
      for (const ticket of ticketsToCreate) {
        try {
          // Check if this ticket already exists in the AGT system
          const isDuplicate = await checkDuplicateTicket(ticket.id);
          if (isDuplicate) {
            console.log(
              `Ticket ${ticket.id} already exists in AGT system, skipping creation`
            );
            continue;
          }

          // Map the project name
          const mappedProjectName =
            settings.AgtProjectNameMapping[ticket.projectName] ||
            ticket.projectName;

          const today = new Date();
          const estDate = new Date(
            today.toLocaleString("en-US", { timeZone: "America/New_York" })
          );
          const dateStr = estDate.toISOString().split("T")[0];

          // Find board config for this ticket to map its status
          const boardConfig = findBoardConfigForTicket(ticket);

          // Map the status if board config exists
          const mappedStatus = boardConfig
            ? mapTicketStatus(ticket.status, boardConfig)
            : ticket.status;

          // Create new ticket
          const newTicketData = {
            team: settings.teamName || "Auxo",
            name: ticket.id,
            projectName: mappedProjectName,
            ticketType: ticket.ticketType,
            status: mappedStatus, // Use mapped status instead of original status
            date: dateStr,
            raisedBy: settings.currentUser || "Jira User",
            storyPoints: ticket.storyPoints || 0,
            story: ticket.name || "",
          };

          console.log(`Creating new ticket in AGT system:`, newTicketData);

          const result = await createNewTicket(newTicketData);
          console.log(`Ticket created with ID: ${result.ticketId}`);

          // If the ticket is created with "Done" status, track for removal
          if (mappedStatus === "Done") {
            console.log(
              `New ticket ${ticket.id} is already Done, marking for removal`
            );
            completedTicketIds.push(ticket.id);
          }

          results.created.push({
            ticketId: ticket.id,
            success: true,
            agtId: result.ticketId,
            status: mappedStatus,
            projectName: mappedProjectName,
            dateCreated: dateStr,
          });
        } catch (error) {
          console.error(`Failed to create ticket ${ticket.id}:`, error);
          results.failed.push({
            ticketId: ticket.id,
            action: "create",
            success: false,
            error: error.message,
          });
        }
      }

      // Remove all completed tickets from savedTickets in one go
      if (completedTicketIds.length > 0) {
        console.log(
          `Removing ${completedTicketIds.length} completed tickets:`,
          completedTicketIds
        );

        // Filter out the completed tickets
        settings.savedTickets = settings.savedTickets.filter(
          (ticket) => !completedTicketIds.includes(ticket.id)
        );

        // Save settings immediately
        saveSettings(settings);

        // Find the tickets modal and refresh it if it's visible
        const ticketsModal = document.querySelector(".jira-tickets-modal");
        if (ticketsModal) {
          // Find the tickets list container
          const ticketsList = ticketsModal.querySelector(
            "div[style*='overflow-y: auto']"
          );
          if (ticketsList) {
            // We need to recreate the refreshTicketsList function since it's defined locally in createTicketsUI
            const refreshList = (listElement) => {
              listElement.innerHTML = "";
              settings.savedTickets?.forEach((ticket) => {
                const item = document.createElement("div");
                item.style.cssText = `
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 10px;
                  border-bottom: 1px solid #eee;
                `;

                const info = document.createElement("div");
                info.innerHTML = `
                  <div><strong>${ticket.id}</strong> - ${ticket.name}</div>
                  <div style="font-size: 12px; color: #666;">
                    ${ticket.projectName} • ${ticket.ticketType} • ${
                  ticket.status
                } 
                    ${
                      ticket.storyPoints ? `• ${ticket.storyPoints} points` : ""
                    }
                  </div>
                `;

                const removeBtn = document.createElement("button");
                removeBtn.textContent = "×";
                removeBtn.style.cssText = `
                  border: none;
                  background: none;
                  color: #666;
                  cursor: pointer;
                  padding: 5px;
                  font-size: 16px;
                `;

                removeBtn.onclick = () => {
                  removeTicket(ticket.id);
                  refreshList(listElement); // Use the local function for recursive calls
                };

                item.appendChild(info);
                item.appendChild(removeBtn);
                listElement.appendChild(item);
              });
            };

            // Call our recreated refresh function
            refreshList(ticketsList);
          }
        }
      }

      return {
        totalUpdates: updatesNeeded.length,
        totalCreated: results.created.length,
        totalFailed: results.failed.length,
        successfulUpdates: results.updated.length,
        successfulCreations: results.created.length,
        completedRemoved: completedTicketIds.length,
        details: {
          updated: results.updated,
          created: results.created,
          failed: results.failed,
        },
      };
    } catch (error) {
      console.error("Error in pushTicketUpdates:", error);
      throw error;
    }
  }

  // Function to parse JIRA API response
  function parseTicketData(data) {
    // Get all boards that match the project
    const matchingBoards = settings.savedBoards.filter((board) => {
      const boardProjectName = settings.boardToProjectMap[board.name];
      return data.fields.project.name === boardProjectName;
    });

    if (matchingBoards.length === 0) {
      // No matching board found
      return {
        id: data.key,
        name: data.fields.summary,
        storyPoints: 0,
        status: data.fields.status.name,
        story: "",
        projectName: data.fields.project.name,
        ticketType: data.fields.issuetype.name,
      };
    }

    // Try to find the correct board by checking if the ticket's current status
    // exists in any of the board's configurations
    const currentStatus = data.fields.status.name;
    const correctBoard = matchingBoards.find((board) => {
      const boardConfig = settings.boardConfigs[board.id];
      if (!boardConfig) return false;

      // Check if the status exists in any category
      return Object.values(boardConfig).some((statuses) =>
        statuses.includes(currentStatus)
      );
    });

    // Use the board that matches the status, or the first board if none match
    const boardToUse = correctBoard || matchingBoards[0];

    // Only use story points if we found the correct board and it has the field configured
    let storyPoints = 0;
    if (boardToUse) {
      const fieldId = settings.storyPointsFields[boardToUse.id];
      if (fieldId && fieldId in data.fields) {
        storyPoints = data.fields[fieldId] || 0;
      }
    }

    return {
      id: data.key,
      name: data.fields.summary,
      storyPoints: storyPoints,
      status: data.fields.status.name,
      story: "",
      projectName: data.fields.project.name,
      ticketType: data.fields.issuetype.name,
    };
  }

  // Function to fetch and add ticket
  async function addTicket(ticketId) {
    try {
      const response = await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: `https://auxosolutions.atlassian.net/rest/api/3/issue/${ticketId}`,
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-AUSERNAME":
              document.querySelector('meta[name="ajs-remote-user"]')?.content ||
              "",
          },
          withCredentials: true,
          onload: function (response) {
            if (response.status === 200) {
              resolve(JSON.parse(response.responseText));
            } else {
              reject(
                new Error(`HTTP ${response.status}: ${response.statusText}`)
              );
            }
          },
          onerror: reject,
        });
      });

      const ticket = parseTicketData(response);

      // Add to settings
      if (!settings.savedTickets) {
        settings.savedTickets = [];
      }

      // Check for duplicates
      const exists = settings.savedTickets.some((t) => t.id === ticket.id);
      if (!exists) {
        settings.savedTickets.push(ticket);
        saveSettings(settings);
      }

      return ticket;
    } catch (error) {
      console.error("Error adding ticket:", error);
      throw error;
    }
  }

  // Function to remove ticket
  function removeTicket(ticketId) {
    settings.savedTickets = settings.savedTickets.filter(
      (t) => t.id !== ticketId
    );
    saveSettings(settings);
  }

  // Function to create tickets UI
  function createTicketsUI() {
    const container = document.createElement("div");
    container.style.cssText = `
      margin-top: 20px;
      padding: 15px;
      border: 1px solid #ddd;
      border-radius: 4px;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    `;

    const title = document.createElement("h3");
    title.textContent = "Saved Tickets";
    title.style.margin = "0";

    // Create buttons container
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 8px;
    `;

    // Add refresh button
    const refreshButton = document.createElement("button");
    refreshButton.textContent = "↻ Refresh All";
    refreshButton.style.cssText = `
      padding: 5px 10px;
      background: #EBECF0;
      color: #42526E;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    refreshButton.onclick = async () => {
      try {
        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing...";

        // Create a copy of saved tickets array
        const ticketsToRefresh = [...settings.savedTickets];
        const refreshedTickets = [];

        // Refresh each ticket
        for (const ticket of ticketsToRefresh) {
          try {
            // Try to refresh the ticket and store the result
            const refreshedTicket = await addTicket(ticket.id);
            refreshedTickets.push(refreshedTicket);
          } catch (error) {
            console.error(`Failed to refresh ticket ${ticket.id}:`, error);
            // Keep the original ticket data if refresh fails
            refreshedTickets.push(ticket);
          }
        }

        // Update settings only after all refreshes are attempted
        settings.savedTickets = refreshedTickets;
        saveSettings(settings);

        refreshTicketsList(ticketsList);
        refreshButton.textContent = "✓ Refreshed";
        setTimeout(() => {
          refreshButton.textContent = "↻ Refresh All";
          refreshButton.disabled = false;
        }, 2000);
      } catch (error) {
        console.error("Error refreshing tickets:", error);
        refreshButton.textContent = "× Error";
        setTimeout(() => {
          refreshButton.textContent = "↻ Refresh All";
          refreshButton.disabled = false;
        }, 2000);
      }
    };

    const syncButton = document.createElement("button");
    syncButton.textContent = "🔄📥 Pull Tickets";
    syncButton.style.cssText = `
                  padding: 5px 10px;
                  background: #EBECF0;
                  color: #42526E;
                  border: none;
                  border-radius: 3px;
                  cursor: pointer;
                `;

    syncButton.onclick = async () => {
      try {
        syncButton.disabled = true;
        syncButton.textContent = "Pulling...";

        const data = await fetchIncompleteTickets();
        console.log("Fetched tickets:", data.tickets);

        // Merge fetched tickets with saved tickets
        const mergedTickets = mergeTickets(settings.savedTickets, data.tickets);

        // Update settings with merged tickets
        settings.savedTickets = mergedTickets;
        saveSettings(settings);

        // Refresh the UI
        refreshTicketsList(ticketsList);

        console.log("Sync completed. Total tickets:", mergedTickets.length);
        console.log("Merged tickets:", mergedTickets);
        syncButton.textContent = "✓ Synced";
        setTimeout(() => {
          syncButton.textContent = "🔄📥 Pull Tickets";
          syncButton.disabled = false;
        }, 2000);
      } catch (error) {
        console.error("Error syncing tickets:", error);
        syncButton.textContent = "× Error";
        setTimeout(() => {
          syncButton.textContent = "🔄📥 Pull Tickets";
          syncButton.disabled = false;
        }, 2000);
      }
    };

    // Add this after the sync button creation in createTicketsUI
    const pushButton = document.createElement("button");
    pushButton.textContent = "📤🌐 Push Tickets";
    pushButton.style.cssText = `
      padding: 5px 10px;
      background: #EBECF0;
      color: #42526E;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    pushButton.onclick = async () => {
      try {
        pushButton.disabled = true;
        pushButton.textContent = "Pushing...";

        const results = await pushTicketUpdates();

        if (results.totalUpdates === 0 && results.totalCreated === 0) {
          pushButton.textContent = "✓ No updates needed";
        } else {
          pushButton.textContent = `✓ Updated ${results.successfulUpdates}/${results.totalUpdates}, Created ${results.successfulCreations}`;

          // Show detailed results in console
          console.log("Push results:", results.details);

          // If there were successful updates, show summary
          if (results.successfulUpdates > 0) {
            const successDetails = results.details.updated
              .filter((r) => r.success)
              .map((r) => `${r.ticketId}: ${r.oldStatus} → ${r.newStatus}`)
              .join("\n");
            console.log("Successfully updated tickets:\n" + successDetails);
          }

          // If there were successful creations, show summary
          if (results.successfulCreations > 0) {
            const creationDetails = results.details.created
              .map((r) => `${r.ticketId}: Created with status ${r.status}`)
              .join("\n");
            console.log("Successfully created tickets:\n" + creationDetails);
          }
        }

        // If there were any failures, show alert
        if (results.totalFailed > 0) {
          console.error("Failed operations:", results.details.failed);
          alert(
            `Failed ${results.totalFailed} operations. Check console for details.`
          );
        }

        setTimeout(() => {
          pushButton.textContent = "📤🌐 Push Tickets";
          pushButton.disabled = false;
        }, 2000);
      } catch (error) {
        console.error("Error pushing tickets:", error);
        pushButton.textContent = "× Error";
        setTimeout(() => {
          pushButton.textContent = "📤🌐 Push Tickets";
          pushButton.disabled = false;
        }, 2000);
      }
    };

    const addButton = document.createElement("button");
    addButton.textContent = "+ Add Ticket";
    addButton.style.cssText = `
      padding: 5px 10px;
      background: #0052CC;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    addButton.onclick = async () => {
      const ticketId = prompt("Enter JIRA ticket ID (e.g. AEPT-287):");
      if (ticketId) {
        try {
          await addTicket(ticketId);
          refreshTicketsList(ticketsList);
        } catch (error) {
          alert(`Error adding ticket: ${error.message}`);
        }
      }
    };

    // Append buttons to container
    buttonsContainer.appendChild(refreshButton);
    buttonsContainer.appendChild(syncButton);
    buttonsContainer.appendChild(pushButton);
    buttonsContainer.appendChild(addButton);

    header.appendChild(title);
    header.appendChild(buttonsContainer);
    container.appendChild(header);

    const ticketsList = document.createElement("div");
    ticketsList.style.cssText = `
      max-height: 300px;
      overflow-y: auto;
    `;

    function refreshTicketsList(listElement) {
      listElement.innerHTML = "";
      settings.savedTickets?.forEach((ticket) => {
        const item = document.createElement("div");
        item.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid #eee;
        `;

        const info = document.createElement("div");
        info.innerHTML = `
          <div><strong>${ticket.id}</strong> - ${ticket.name}</div>
          <div style="font-size: 12px; color: #666;">
            ${ticket.projectName} • ${ticket.ticketType} • ${ticket.status} 
            ${ticket.storyPoints ? `• ${ticket.storyPoints} points` : ""}
          </div>
        `;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "×";
        removeBtn.style.cssText = `
          border: none;
          background: none;
          color: #666;
          cursor: pointer;
          padding: 5px;
          font-size: 16px;
        `;

        removeBtn.onclick = () => {
          removeTicket(ticket.id);
          refreshTicketsList(listElement);
        };

        item.appendChild(info);
        item.appendChild(removeBtn);
        listElement.appendChild(item);
      });
    }

    container.appendChild(ticketsList);

    // Initial list population
    refreshTicketsList(ticketsList);

    return container;
  }

  // Add this function to create the add ticket button
  function createAddTicketButton(ticketId) {
    const button = document.createElement("button");
    button.className = "add-ticket-button";

    // Check if ticket is already saved
    const isAlreadySaved = settings.savedTickets?.some(
      (t) => t.id === ticketId
    );

    button.style.cssText = `
      border: none;
      background: none;
      cursor: ${isAlreadySaved ? "default" : "pointer"};
      font-size: 14px;
      padding: 4px;
      color: ${isAlreadySaved ? "#36B37E" : "#42526E"};
      opacity: 0.7;
      transition: opacity 0.2s;
    `;

    if (isAlreadySaved) {
      button.innerHTML = "✓ Added";
      button.title = "Already in Saved Tickets";
      return button;
    }

    button.innerHTML = "➕ Add Ticket to Jira Stats";
    button.title = "Add to Saved Tickets";

    button.onmouseover = () => (button.style.opacity = "1");
    button.onmouseleave = () => (button.style.opacity = "0.7");

    button.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await addTicket(ticketId);
        button.innerHTML = "✓ Added";
        button.style.color = "#36B37E";
        button.style.cursor = "default";
        // Remove event listeners since ticket is now saved
        button.onmouseover = null;
        button.onmouseleave = null;
        button.onclick = null;
      } catch (error) {
        console.error("Error adding ticket:", error);
        button.innerHTML = "× Error";
        button.style.color = "#FF5630";
        setTimeout(() => {
          button.innerHTML = "➕ Add Ticket to Jira Stats";
          button.style.color = "#42526E";
        }, 2000);
      }
    };

    return button;
  }

  // Modify the injectIntoList function to handle multiple ULs
  function injectIntoList(container) {
    // Find all UL elements within the container
    const allLists = container.getElementsByTagName("ul");

    Array.from(allLists).forEach((list) => {
      const listItems = list.getElementsByTagName("li");
      Array.from(listItems).forEach((li) => {
        // Check if button already exists
        if (li.querySelector(".add-ticket-button")) return;

        const ticketId = INJECTION_POINTS.YOUR_WORK_TABS.getTicketId(li);
        if (!ticketId) return;

        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
          display: inline-block;
          margin-right: 8px;
          vertical-align: middle;
        `;
        buttonContainer.appendChild(createAddTicketButton(ticketId));

        // Insert before the first child of li
        li.insertBefore(buttonContainer, li.firstChild);
      });
    });
  }

  // Update injectIntoTicketDetails function to use new getTicketId
  function injectIntoTicketDetails() {
    const container = document.querySelector(
      INJECTION_POINTS.TICKET_DETAILS.containerSelector
    );
    if (!container) return;

    const target = document.querySelector(
      INJECTION_POINTS.TICKET_DETAILS.targetSelector
    );
    if (!target) return;

    // Get the first direct descendant div
    const targetDiv = target.querySelector(":scope > div");
    if (!targetDiv) return;

    // Check if button already exists
    if (target.querySelector(".add-ticket-button")) return;

    const ticketId = INJECTION_POINTS.TICKET_DETAILS.getTicketId(container);
    if (!ticketId) return;

    const buttonWrapper = document.createElement("div");
    buttonWrapper.style.cssText = `
      display: flex;
      align-items: center;
      margin-left: 8px;
    `;

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: inline-flex;
      align-items: center;
    `;

    const addButton = document.createElement("button");
    addButton.className = "add-ticket-button";
    addButton.setAttribute("type", "button");
    addButton.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--ds-text, #42526E);
      padding: 8px;
      border-radius: 3px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
      white-space: nowrap;
    `;

    const isAlreadySaved = settings.savedTickets?.some(
      (t) => t.id === ticketId
    );

    if (isAlreadySaved) {
      addButton.innerHTML = `<span style="color: #36B37E;">✓ Added</span>`;
      addButton.style.cursor = "default";
    } else {
      addButton.innerHTML = `<span>➕ Add Ticket to Jira Stats</span>`;

      addButton.onmouseover = () => {
        addButton.style.background =
          "var(--ds-background-neutral-subtle, #F4F5F7)";
      };
      addButton.onmouseleave = () => {
        addButton.style.background = "none";
      };

      addButton.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await addTicket(ticketId);
          addButton.innerHTML = `<span style="color: #36B37E;">✓ Added</span>`;
          addButton.style.cursor = "default";
          addButton.onmouseover = null;
          addButton.onmouseleave = null;
          addButton.onclick = null;
        } catch (error) {
          console.error("Error adding ticket:", error);
          addButton.innerHTML = `<span style="color: #FF5630;">× Error</span>`;
          setTimeout(() => {
            addButton.innerHTML = `<span>➕ Add Ticket to Jira Stats</span>`;
          }, 2000);
        }
      };
    }

    buttonContainer.appendChild(addButton);
    buttonWrapper.appendChild(buttonContainer);
    targetDiv.appendChild(buttonWrapper); // Changed from target to targetDiv
  }

  // Update the injectAddTicketButtons function
  function injectAddTicketButtons() {
    // Handle Your Work tabs
    const yourWorkTabs = document.querySelectorAll(
      INJECTION_POINTS.YOUR_WORK_TABS.selector
    );

    yourWorkTabs.forEach((tab) => {
      injectIntoList(tab);

      const observer = new MutationObserver((mutations) => {
        injectIntoList(tab);
      });

      observer.observe(tab, {
        childList: true,
        subtree: true,
      });
    });

    // Handle Ticket Details page
    injectIntoTicketDetails();
  }

  // Settings Management
  async function loadSettings() {
    const savedSettings = localStorage.getItem("jiraStandupSettings");
    let settings = savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;

    settings.savedBoards = settings.savedBoards || DEFAULT_SETTINGS.savedBoards;
    settings.boardConfigs =
      settings.boardConfigs || DEFAULT_SETTINGS.boardConfigs;
    settings.savedTickets =
      settings.savedTickets || DEFAULT_SETTINGS.savedTickets;
    settings.apiKey = settings.apiKey || DEFAULT_SETTINGS.apiKey;
    settings.storyPointsFields =
      settings.storyPointsFields || DEFAULT_SETTINGS.storyPointsFields;
    settings.savedProjects =
      settings.savedProjects || DEFAULT_SETTINGS.savedProjects;
    settings.boardToProjectMap =
      settings.boardToProjectMap || DEFAULT_SETTINGS.boardToProjectMap;
    settings.AgtProjectNameMapping =
      settings.AgtProjectNameMapping || DEFAULT_SETTINGS.AgtProjectNameMapping;
    settings.currentUser = settings.currentUser || DEFAULT_SETTINGS.currentUser;
    settings.teamName = settings.teamName || DEFAULT_SETTINGS.teamName;

    return settings;
  }

  function saveSettings(newSettings) {
    localStorage.setItem("jiraStandupSettings", JSON.stringify(newSettings));
    settings = newSettings;
  }

  // UI Creation Functions
  function createHeaderButton() {
    const container = document.createElement("div");
    container.setAttribute("role", "listitem");
    container.className = "css-bjn8wh";

    const button = document.createElement("button");
    button.className = "css-oshqpj";
    button.setAttribute("aria-label", "Tickets");
    button.setAttribute("tabindex", "0");
    button.setAttribute("type", "button");
    button.innerHTML = "📜";

    container.appendChild(button);
    return container;
  }

  function createSavedTicketsModal() {
    const modal = document.createElement("div");
    modal.classList.add("jira-tickets-modal");
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 0 10px rgba(0,0,0,0.2);
      z-index: 10000;
      max-width: 800px;
      width: 90%;
    `;

    // Header with title, settings and close buttons
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    `;

    // Left side with title
    const titleSection = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = "Tickets";
    title.style.margin = "0";
    titleSection.appendChild(title);

    // Right side with buttons
    const buttonsSection = document.createElement("div");
    buttonsSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const settingsButton = document.createElement("button");
    settingsButton.innerHTML = "⚙️";
    settingsButton.title = "Settings";
    settingsButton.style.cssText = `
      border: none;
      background: none;
      cursor: pointer;
      font-size: 16px;
      padding: 4px 8px;
    `;

    const closeButton = document.createElement("button");
    closeButton.innerHTML = "×";
    closeButton.title = "Close";
    closeButton.style.cssText = `
      border: none;
      background: none;
      cursor: pointer;
      font-size: 20px;
      padding: 4px 8px;
      color: #666;
      line-height: 1;
    `;

    settingsButton.onclick = () => {
      modal.remove();
      const settingsUI = createSettingsUI();
      settingsUI.classList.add("jira-settings-modal");
      document.body.appendChild(settingsUI);
    };

    closeButton.onclick = () => {
      modal.remove();
    };

    buttonsSection.appendChild(settingsButton);
    buttonsSection.appendChild(closeButton);

    header.appendChild(titleSection);
    header.appendChild(buttonsSection);
    modal.appendChild(header);

    // Add tickets section
    const ticketsSection = createTicketsUI();
    ticketsSection.style.margin = "0"; // Override original margin
    modal.appendChild(ticketsSection);

    return modal;
  }

  function createSettingsUI() {
    // Create base container
    const container = document.createElement("div");
    container.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
        z-index: 10000;
        max-width: 800px;
        width: 90%;
      `;

    // Add title
    const title = document.createElement("h3");
    title.textContent = "JIRA Stats Settings";
    title.style.marginBottom = "20px";
    container.appendChild(title);

    // Add current user input
    container.appendChild(createUserSection());

    // Add projects section first
    container.appendChild(createProjectsSection());

    // Add boards section
    container.appendChild(createBoardsSection());

    // Add footer buttons
    container.appendChild(createFooterButtons(container));

    return container;
  }

  function createUserSection() {
    const section = document.createElement("div");
    section.style.marginBottom = "20px";

    // Create flex container for User Name and Team Name
    const flexContainer = document.createElement("div");
    flexContainer.style.cssText = `
      display: flex;
      gap: 20px;
      margin-bottom: 10px;
    `;

    // User Name field
    const userWrapper = document.createElement("div");
    userWrapper.style.cssText = `
      flex: 1;
    `;

    const userLabel = document.createElement("label");
    userLabel.textContent = "User Name:";
    userLabel.style.cssText = `
      display: block;
      margin-bottom: 5px;
    `;

    const userInput = document.createElement("input");
    userInput.type = "text";
    userInput.value = settings.currentUser;
    userInput.style.cssText = `
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-sizing: border-box;
    `;
    userInput.id = "settings-current-user";

    userWrapper.appendChild(userLabel);
    userWrapper.appendChild(userInput);

    // Team Name field
    const teamWrapper = document.createElement("div");
    teamWrapper.style.cssText = `
      flex: 1;
    `;

    const teamLabel = document.createElement("label");
    teamLabel.textContent = "Team Name:";
    teamLabel.style.cssText = `
      display: block;
      margin-bottom: 5px;
    `;

    const teamInput = document.createElement("input");
    teamInput.type = "text";
    teamInput.value = settings.teamName || ""; // Use existing value or empty string
    teamInput.style.cssText = `
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-sizing: border-box;
    `;
    teamInput.id = "settings-team-name";

    teamWrapper.appendChild(teamLabel);
    teamWrapper.appendChild(teamInput);

    // Add both wrappers to flex container
    flexContainer.appendChild(userWrapper);
    flexContainer.appendChild(teamWrapper);
    section.appendChild(flexContainer);

    // Add API Key input
    const apiKeyLabel = document.createElement("label");
    apiKeyLabel.textContent = "API Key (Optional):";
    apiKeyLabel.style.display = "block";
    apiKeyLabel.style.marginTop = "10px";
    apiKeyLabel.style.marginBottom = "5px";

    const apiKeyContainer = document.createElement("div");
    apiKeyContainer.style.display = "flex";
    apiKeyContainer.style.alignItems = "center";
    apiKeyContainer.style.gap = "5px";

    const apiKeyInput = document.createElement("input");
    apiKeyInput.type = "password";
    apiKeyInput.value = settings.apiKey || ""; // Ensure value is not null/undefined
    apiKeyInput.placeholder = "Enter your JIRA API Key";
    apiKeyInput.style.cssText = `
        flex-grow: 1; /* Take remaining width */
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-sizing: border-box;
      `;
    apiKeyInput.id = "settings-api-key";

    const revealButton = document.createElement("button");
    revealButton.textContent = "👁️"; // Use an eye icon or text like "Show"
    revealButton.type = "button"; // Prevent form submission
    revealButton.title = "Show/Hide API Key";
    revealButton.style.cssText = `
        padding: 8px;
        background: #f4f5f7;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        line-height: 1; /* Adjust for icon alignment */
      `;

    revealButton.onclick = () => {
      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        revealButton.textContent = "🔒"; // Or "Hide"
      } else {
        apiKeyInput.type = "password";
        revealButton.textContent = "👁️"; // Or "Show"
      }
    };

    apiKeyContainer.appendChild(apiKeyInput);
    apiKeyContainer.appendChild(revealButton);

    section.appendChild(apiKeyLabel);
    section.appendChild(apiKeyContainer);

    return section;
  }

  function createProjectsSection() {
    const section = document.createElement("div");
    section.style.cssText = `
        margin-bottom: 20px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 15px;
    `;

    const header = document.createElement("h4");
    header.textContent = "Manage Projects";
    header.style.marginBottom = "15px";
    section.appendChild(header);

    const table = document.createElement("table");
    table.style.cssText = `
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
    `;

    // Create table header with new AGT column
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.style.cssText = `
        background: #f4f5f7;
        font-weight: 500;
    `;

    ["Project Name", "Associated Boards", "AGT Project Name"].forEach(
      (text) => {
        const th = document.createElement("th");
        th.textContent = text;
        th.style.cssText = `
            padding: 8px;
            text-align: left;
            border-bottom: 2px solid #ddd;
        `;
        headerRow.appendChild(th);
      }
    );
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement("tbody");

    // Initialize AgtProjectNameMapping in settings if it doesn't exist
    if (!settings.AgtProjectNameMapping) {
      settings.AgtProjectNameMapping = {};
    }

    // Group boards by project
    const projectBoards = {};
    for (const [boardName, projectName] of Object.entries(
      settings.boardToProjectMap
    )) {
      if (!projectBoards[projectName]) {
        projectBoards[projectName] = [];
      }
      projectBoards[projectName].push(boardName);
    }

    // Create rows for each project
    Object.entries(projectBoards).forEach(([projectName, boards]) => {
      const row = document.createElement("tr");
      row.style.cssText = `
            border-bottom: 1px solid #eee;
        `;

      // Project name cell
      const projectCell = document.createElement("td");
      projectCell.textContent = projectName;
      projectCell.style.padding = "8px";

      // Associated boards cell
      const boardsCell = document.createElement("td");
      boardsCell.style.padding = "8px";

      // Create pills for each board
      const boardsList = document.createElement("div");
      boardsList.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        `;

      boards.forEach((boardName) => {
        const pill = document.createElement("span");
        pill.textContent = boardName;
        pill.style.cssText = `
                background: #ebecf0;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                color: #42526e;
            `;
        boardsList.appendChild(pill);
      });

      boardsCell.appendChild(boardsList);

      // AGT Project Name cell with input field
      const agtCell = document.createElement("td");
      agtCell.style.padding = "8px";

      const agtInput = document.createElement("input");
      agtInput.type = "text";
      agtInput.value = settings.AgtProjectNameMapping[projectName] || "";
      agtInput.placeholder = "Enter AGT project name";
      agtInput.dataset.projectName = projectName; // Store project name for saving
      agtInput.style.cssText = `
            width: 100%;
            padding: 6px;
            border: 1px solid #ddd;
            border-radius: 3px;
            font-size: 12px;
        `;
      agtCell.appendChild(agtInput);

      row.appendChild(projectCell);
      row.appendChild(boardsCell);
      row.appendChild(agtCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    section.appendChild(table);

    return section;
  }

  function createBoardsSection() {
    const section = document.createElement("div");
    section.style.cssText = `
        margin-bottom: 20px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 15px;
      `;

    const header = document.createElement("h4");
    header.textContent = "Manage Boards";
    header.style.marginBottom = "15px";
    section.appendChild(header);

    const boardsList = document.createElement("div");
    boardsList.style.cssText = `
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid #eee;
        border-radius: 4px;
        padding: 10px;
      `;

    const loadingMessage = document.createElement("div");
    loadingMessage.textContent = "Loading boards...";
    loadingMessage.style.fontSize = "14px";
    boardsList.appendChild(loadingMessage);

    // Fetch and display boards
    fetchBoards()
      .then((boards) => {
        boardsList.innerHTML = "";
        boards.forEach((board) => {
          const boardItem = createBoardItem(board);
          boardsList.appendChild(boardItem);
        });
      })
      .catch((error) => {
        boardsList.innerHTML = `
            <div style="color: red; padding: 10px;">
              Error loading boards: ${error.message}
            </div>
          `;
      });

    section.appendChild(boardsList);
    return section;
  }

  function createBoardItem(board) {
    const item = document.createElement("div");
    item.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px;
        border-bottom: 1px solid #eee;
    `;

    // Left section with checkbox and name
    const leftSection = document.createElement("div");
    leftSection.style.display = "flex";
    leftSection.style.alignItems = "center";
    leftSection.style.flexGrow = "1";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.marginRight = "8px";
    checkbox.checked = settings.savedBoards.some(
      (saved) => saved.id === board.id
    );

    const name = document.createElement("span");
    name.textContent = board.name;
    name.style.cssText = `
        font-size: 14px;
        margin-right: 12px;
        flex-grow: 1;
    `;

    checkbox.onchange = () => {
      if (checkbox.checked) {
        settings.savedBoards.push({
          id: board.id,
          name: board.name,
        });
      } else {
        settings.savedBoards = settings.savedBoards.filter(
          (saved) => saved.id !== board.id
        );
      }
    };

    leftSection.appendChild(checkbox);
    leftSection.appendChild(name);

    // Configure button (right section)
    const configButton = document.createElement("button");
    configButton.innerHTML = "⚙️";
    configButton.title = "Configure Columns";
    configButton.style.cssText = `
        border: none;
        background: none;
        cursor: pointer;
        opacity: 0.7;
        padding: 4px 8px;
        font-size: 14px;
    `;

    // Rest of the existing configButton code...
    configButton.onclick = async () => {
      try {
        configButton.style.opacity = "0.3";
        const config = await fetchBoardConfig(board.id);

        if (!config?.columnConfig?.columns) {
          throw new Error("Invalid board configuration");
        }

        const settingsModal = document.querySelector(".jira-settings-modal");
        if (settingsModal) {
          settingsModal.remove();
        }

        document.body.appendChild(
          createColumnConfigModal(board, config.columnConfig.columns)
        );
      } catch (error) {
        alert(`Failed to load board configuration: ${error.message}`);
      } finally {
        configButton.style.opacity = "0.7";
      }
    };

    item.appendChild(leftSection);
    item.appendChild(configButton);
    return item;
  }

  function createFooterButtons(container) {
    const footer = document.createElement("div");
    footer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
        padding-top: 15px;
        border-top: 1px solid #eee;
      `;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save";
    saveButton.style.cssText = `
        padding: 8px 16px;
        background: #0052CC;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      `;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.style.cssText = `
        padding: 8px 16px;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
      `;

    saveButton.onclick = () => {
      const userInput = container.querySelector("#settings-current-user");
      const teamInput = container.querySelector("#settings-team-name");
      const apiKeyInput = container.querySelector("#settings-api-key");
      const agtProjectNameMapping = {};
      const agtInputs = container.querySelectorAll("input[data-project-name]");
      agtInputs.forEach((input) => {
        if (input.value.trim()) {
          agtProjectNameMapping[input.dataset.projectName] = input.value.trim();
        }
      });

      const newSettings = {
        ...settings,
        currentUser: userInput.value,
        teamName: teamInput.value,
        apiKey: apiKeyInput.value,
        AgtProjectNameMapping: agtProjectNameMapping,
      };

      saveSettings(newSettings);
      container.remove();

      // Open Tickets modal
      document.body.appendChild(createSavedTicketsModal());
    };

    cancelButton.onclick = () => {
      container.remove();
      // Open Tickets modal
      document.body.appendChild(createSavedTicketsModal());
    };

    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);
    return footer;
  }

  function createColumnConfigModal(board, columns) {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 0 10px rgba(0,0,0,0.2);
      z-index: 10001;
      max-width: 600px;
      width: 90%;
    `;

    // Initialize board config if not exists
    if (!settings.boardConfigs[board.id]) {
      settings.boardConfigs[board.id] = {
        inProgress: [],
        inQA: [],
        done: [],
        cancelled: [],
      };
    }

    const config = settings.boardConfigs[board.id];

    // Create title
    const title = document.createElement("h3");
    title.textContent = `Configure Columns - ${board.name}`;
    title.style.marginBottom = "20px";
    modal.appendChild(title);

    // Add Story Points Field section
    const storyPointsSection = document.createElement("div");
    storyPointsSection.style.cssText = `
      margin-bottom: 20px;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
    `;

    const storyPointsHeader = document.createElement("h4");
    storyPointsHeader.textContent = "Story Points Configuration";
    storyPointsHeader.style.margin = "0 0 10px 0";
    storyPointsSection.appendChild(storyPointsHeader);

    const fieldContainer = document.createElement("div");
    fieldContainer.style.cssText = `
      display: flex;
      gap: 10px;
      align-items: flex-start;
    `;

    const inputWrapper = document.createElement("div");
    inputWrapper.style.flexGrow = "1";

    const label = document.createElement("label");
    label.textContent = "Story Points Field Name:";
    label.style.cssText = `
      display: block;
      margin-bottom: 5px;
      font-size: 14px;
    `;

    const input = document.createElement("input");
    input.type = "text";
    input.value = settings.storyPointsFields[board.id] || "";
    input.id = `story-points-field-${board.id}`;
    input.style.cssText = `
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-sizing: border-box;
    `;

    const helpText = document.createElement("div");
    helpText.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    `;
    helpText.innerHTML = `

      This is the JIRA field name used for story points.<br>
      Value is loaded from boards by default, update if it fails to do so.<br>
      You can find this by exporting a ticket as XML from the 3 dots menu when viewing a ticket.
    `;

    inputWrapper.appendChild(label);
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(helpText);
    fieldContainer.appendChild(inputWrapper);
    storyPointsSection.appendChild(fieldContainer);

    modal.appendChild(storyPointsSection);

    // Add Available Columns section at the top
    const availableSection = document.createElement("div");
    availableSection.style.cssText = `
        margin-bottom: 20px;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
    `;

    const availableTitle = document.createElement("h4");
    availableTitle.textContent = "Available Columns";
    availableTitle.style.margin = "0 0 10px 0";
    availableSection.appendChild(availableTitle);

    const columnsList = document.createElement("div");
    columnsList.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    `;

    // Create a function to update available columns display
    function updateAvailableColumns() {
      // Clear existing columns list
      columnsList.innerHTML = "";

      // Get all selected columns
      const selectedColumns = new Set();
      Object.values(config).forEach((categoryColumns) => {
        categoryColumns.forEach((col) => selectedColumns.add(col));
      });

      // Display available columns
      columns.forEach((column) => {
        if (!selectedColumns.has(column.name)) {
          const columnItem = document.createElement("div");
          columnItem.style.cssText = `
                    padding: 4px 8px;
                    background: #f4f5f7;
                    border-radius: 3px;
                    font-size: 12px;
                    color: #42526E;
                `;
          columnItem.textContent = column.name;
          columnsList.appendChild(columnItem);
        }
      });

      // If no available columns, show a message
      if (columnsList.children.length === 0) {
        const noColumnsMsg = document.createElement("div");
        noColumnsMsg.style.cssText = `
                padding: 4px 8px;
                color: #6B778C;
                font-style: italic;
                font-size: 12px;
            `;
        noColumnsMsg.textContent = "No available columns";
        columnsList.appendChild(noColumnsMsg);
      }
    }

    availableSection.appendChild(columnsList);
    modal.appendChild(availableSection);

    // Create categories
    const categories = [
      { key: "inProgress", label: "In Progress" },
      { key: "inQA", label: "In QA" },
      { key: "done", label: "Done" },
      { key: "cancelled", label: "Cancelled" },
    ];

    categories.forEach((category) => {
      const section = createCategorySection(
        category,
        columns,
        config,
        updateAvailableColumns
      );
      modal.appendChild(section);
    });

    // Initial population of available columns
    updateAvailableColumns();

    // Add footer buttons
    modal.appendChild(createConfigModalFooter(modal, board.id, config));

    return modal;
  }

  function createCategorySection(
    category,
    allColumns,
    config,
    updateAvailableColumns
  ) {
    const section = document.createElement("div");
    section.style.cssText = `
      margin-bottom: 15px;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    `;

    const label = document.createElement("h4");
    label.textContent = category.label;
    label.style.margin = "0";

    const addButton = document.createElement("button");
    addButton.textContent = "+ Add Column";
    addButton.style.cssText = `
      padding: 4px 8px;
      background: #0052CC;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    `;

    const columnList = document.createElement("div");
    columnList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 5px;
    `;

    // Add existing columns
    config[category.key].forEach((columnName) => {
      columnList.appendChild(
        createColumnItem(
          columnName,
          category.key,
          config,
          updateAvailableColumns
        )
      );
    });

    addButton.onclick = () => {
      const allSelectedColumns = new Set();
      Object.values(config).forEach((categoryColumns) => {
        categoryColumns.forEach((col) => allSelectedColumns.add(col));
      });

      const availableColumns = allColumns.filter(
        (col) => !allSelectedColumns.has(col.name)
      );

      const modal = createColumnSelectionModal(
        availableColumns,
        config[category.key],
        (selectedColumns) => {
          selectedColumns.forEach((col) => {
            if (!config[category.key].includes(col)) {
              config[category.key].push(col);
              columnList.appendChild(
                createColumnItem(
                  col,
                  category.key,
                  config,
                  updateAvailableColumns
                )
              );
            }
          });
          // Update available columns after adding new ones
          updateAvailableColumns();
        }
      );
      document.body.appendChild(modal);
    };

    header.appendChild(label);
    header.appendChild(addButton);
    section.appendChild(header);
    section.appendChild(columnList);

    return section;
  }

  function createColumnItem(
    columnName,
    category,
    config,
    updateAvailableColumns
  ) {
    const item = document.createElement("div");
    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 8px;
      background: #f4f5f7;
      border-radius: 3px;
      font-size: 13px;
    `;

    const text = document.createElement("span");
    text.textContent = columnName;

    const removeButton = document.createElement("button");
    removeButton.innerHTML = "×";
    removeButton.style.cssText = `
      border: none;
      background: none;
      color: #666;
      cursor: pointer;
      padding: 0 5px;
      font-size: 16px;
    `;

    removeButton.onclick = () => {
      config[category] = config[category].filter((col) => col !== columnName);
      item.remove();
      // Update available columns after removing one
      updateAvailableColumns();
    };

    item.appendChild(text);
    item.appendChild(removeButton);
    return item;
  }

  function createColumnSelectionModal(allColumns, selectedColumns, onSave) {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 20px;
      border-radius: 5px;
      box-shadow: 0 0 10px rgba(0,0,0,0.2);
      z-index: 10002;
      width: 300px;
    `;

    const title = document.createElement("h4");
    title.textContent = "Select Columns";
    title.style.marginBottom = "15px";
    modal.appendChild(title);

    // Create lists section for available columns
    const columnsList = document.createElement("div");
    columnsList.style.cssText = `
      max-height: 300px;
      overflow-y: auto;
      margin-bottom: 15px;
    `;

    // Only check selected columns for current category, not all boards
    const currentlySelectedColumns = new Set(selectedColumns);

    // Show columns that aren't in current category
    allColumns.forEach((column) => {
      if (!currentlySelectedColumns.has(column.name)) {
        const row = document.createElement("div");
        row.style.marginBottom = "8px";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = column.name;
        checkbox.id = `col-${column.id}`;
        checkbox.style.marginRight = "8px";

        const label = document.createElement("label");
        label.htmlFor = `col-${column.id}`;
        label.textContent = column.name;

        row.appendChild(checkbox);
        row.appendChild(label);
        columnsList.appendChild(row);
      }
    });

    modal.appendChild(columnsList);

    // Add custom column input
    const customSection = document.createElement("div");
    customSection.style.cssText = `
      padding-top: 10px;
      border-top: 1px solid #eee;
      margin-bottom: 15px;
    `;

    const customCheckbox = document.createElement("input");
    customCheckbox.type = "checkbox";
    customCheckbox.id = "custom-column";
    customCheckbox.style.marginRight = "8px";

    const customLabel = document.createElement("label");
    customLabel.htmlFor = "custom-column";
    customLabel.textContent = "Add Custom Column";

    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.style.cssText = `
      width: 100%;
      margin-top: 8px;
      padding: 5px;
      border: 1px solid #ddd;
      border-radius: 3px;
      display: none;
    `;

    customCheckbox.onchange = () => {
      customInput.style.display = customCheckbox.checked ? "block" : "none";
      customInput.value = "";
    };

    customSection.appendChild(customCheckbox);
    customSection.appendChild(customLabel);
    customSection.appendChild(customInput);
    modal.appendChild(customSection);

    // Add footer buttons
    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    `;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Add";
    saveButton.style.cssText = `
      padding: 6px 12px;
      background: #0052CC;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    `;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.style.cssText = `
      padding: 6px 12px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
    `;

    saveButton.onclick = () => {
      const selected = Array.from(
        modal.querySelectorAll(
          'input[type="checkbox"]:checked:not(#custom-column)'
        )
      ).map((cb) => cb.value);

      if (customCheckbox.checked && customInput.value.trim()) {
        const customValue = customInput.value.trim();
        if (!currentlySelectedColumns.has(customValue)) {
          selected.push(customValue);
        }
      }

      if (selected.length > 0) {
        onSave(selected);
        modal.remove();
      }
    };

    cancelButton.onclick = () => modal.remove();

    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);
    modal.appendChild(footer);

    return modal;
  }

  function createConfigModalFooter(modal, boardId, config) {
    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    `;

    const saveButton = document.createElement("button");
    saveButton.textContent = "Save Configuration";
    saveButton.style.cssText = `
      padding: 8px 16px;
      background: #0052CC;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.style.cssText = `
      padding: 8px 16px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
    `;

    saveButton.onclick = () => {
      settings.boardConfigs[boardId] = config;
      const storyPointsInput = modal.querySelector(
        `#story-points-field-${boardId}`
      );
      if (storyPointsInput) {
        settings.storyPointsFields[boardId] =
          storyPointsInput.value.trim() || "";
      }
      saveSettings(settings);
      modal.remove();

      // Re-open settings modal
      const settingsUI = createSettingsUI();
      settingsUI.classList.add("jira-settings-modal");
      document.body.appendChild(settingsUI);
    };

    cancelButton.onclick = () => {
      modal.remove();

      // Re-open settings modal
      const settingsUI = createSettingsUI();
      settingsUI.classList.add("jira-settings-modal");
      document.body.appendChild(settingsUI);
    };

    footer.appendChild(cancelButton);
    footer.appendChild(saveButton);
    return footer;
  }

  // New helper function to handle button injection
  function injectSettingsButton() {
    const actionsList = document.querySelector(
      '[data-vc="atlassian-navigation-secondary-actions"]'
    );
    const existingButton = actionsList?.querySelector(
      '.css-bjn8wh button[aria-label="Tickets"]'
    );

    if (actionsList && !existingButton) {
      console.log("Injecting Tickets button");
      const newButton = createHeaderButton();
      actionsList.insertBefore(newButton, actionsList.firstChild);

      // Add click handler with toggle functionality
      newButton.querySelector("button").onclick = () => {
        const existingModal = document.querySelector(".jira-tickets-modal");
        const existingSettings = document.querySelector(".jira-settings-modal");

        if (existingModal) {
          existingModal.remove();
        } else {
          if (existingSettings) {
            existingSettings.remove();
          }
          document.body.appendChild(createSavedTicketsModal());
        }
      };
    }
  }

  function setupPageChangeObserver() {
    let isProcessing = false;

    injectSettingsButton();
    injectAddTicketButtons();

    const observer = new MutationObserver((mutations) => {
      if (isProcessing) return;
      isProcessing = true;

      injectSettingsButton();
      injectAddTicketButtons();

      setTimeout(() => {
        isProcessing = false;
      }, 100);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
  }

  async function start() {
    try {
      settings = await loadSettings();
      setupPageChangeObserver();
    } catch (error) {
      console.error("Failed to initialize JIRA Settings:", error);
    }
  }

  start();
})();
