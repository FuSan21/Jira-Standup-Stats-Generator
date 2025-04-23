// ==UserScript==
// @name         JIRA Stand Up
// @namespace    https://www.fusan.live
// @version      0.1.0
// @description  Intrigate Stand Up with JIRA
// @author       Md Fuad Hasan
// @match        https://auxosolutions.atlassian.net/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-standup.user.js
// @downloadURL  https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-standup.user.js
// ==/UserScript==

(function () {
  "use strict";

  // Default values for settings
  const DEFAULT_SETTINGS = {
    currentUser: "",
    apiKey: "",
    timezone: "America/New_York",
    savedBoards: [],
    boardConfigs: {},
    savedTickets: [],
    storyPointsField: "customfield_10034",
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
        name: "",
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
  async function fetchCurrentUser() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://auxosolutions.atlassian.net/rest/api/latest/myself",
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
            resolve({
              displayName: data.displayName,
              timezone: data.timeZone,
            });
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

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

  // Function to parse JIRA API response
  function parseTicketData(data) {
    return {
      id: data.key,
      name: data.fields.summary,
      storyPoints: data.fields[settings.storyPointsField] || 0,
      status: data.fields.status.name,
      story: data.fields.description || "",
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
    syncButton.textContent = "🔄 Sync Stats";
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
        syncButton.textContent = "Syncing...";

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
          syncButton.textContent = "🔄 Sync Stats";
          syncButton.disabled = false;
        }, 2000);
      } catch (error) {
        console.error("Error syncing tickets:", error);
        syncButton.textContent = "× Error";
        setTimeout(() => {
          syncButton.textContent = "🔄 Sync Stats";
          syncButton.disabled = false;
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
    const savedSettings = localStorage.getItem("jiraStatsSettings");
    let settings = savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;

    settings.savedBoards = settings.savedBoards || DEFAULT_SETTINGS.savedBoards;
    settings.boardConfigs =
      settings.boardConfigs || DEFAULT_SETTINGS.boardConfigs;

    if (!settings.currentUser || !settings.timezone) {
      try {
        const userData = await fetchCurrentUser();
        settings.currentUser = userData.displayName;
        settings.timezone = userData.timezone;
        saveSettings(settings);
      } catch (error) {
        console.error("Error fetching current user:", error);
      }
    }

    settings.apiKey = settings.apiKey || DEFAULT_SETTINGS.apiKey;

    return settings;
  }

  function saveSettings(newSettings) {
    localStorage.setItem("jiraStatsSettings", JSON.stringify(newSettings));
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
  // Add this function after createUserSection
  function createStoryPointsSection() {
    const section = document.createElement("div");
    section.style.cssText = `
    margin-bottom: 20px;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 4px;
  `;

    const header = document.createElement("h4");
    header.textContent = "Story Points Configuration";
    header.style.marginBottom = "15px";
    section.appendChild(header);

    const fieldContainer = document.createElement("div");
    fieldContainer.style.cssText = `
    display: flex;
    gap: 10px;
    align-items: flex-start;
  `;

    const inputWrapper = document.createElement("div");
    inputWrapper.style.cssText = `
    flex-grow: 1;
  `;

    const label = document.createElement("label");
    label.textContent = "Story Points Field Name:";
    label.style.cssText = `
    display: block;
    margin-bottom: 5px;
    font-size: 14px;
  `;

    const input = document.createElement("input");
    input.type = "text";
    input.value = settings.storyPointsField || "customfield_10034";
    input.id = "story-points-field";
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
    Default: customfield_10034<br>
    This is the JIRA field name used for story points.<br>
    You can find this by exporting a ticket as XML from the 3 dots menu from top-right corner when viewing a ticket.
  `;

    inputWrapper.appendChild(label);
    inputWrapper.appendChild(input);
    inputWrapper.appendChild(helpText);
    fieldContainer.appendChild(inputWrapper);
    section.appendChild(fieldContainer);

    return section;
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

    // Add story points configuration
    container.appendChild(createStoryPointsSection());

    // Add boards section
    container.appendChild(createBoardsSection());

    // Add footer buttons
    container.appendChild(createFooterButtons(container));

    return container;
  }

  function createUserSection() {
    const section = document.createElement("div");
    section.style.marginBottom = "20px";

    const userLabel = document.createElement("label");
    userLabel.textContent = "Current User:";
    userLabel.style.display = "block";
    userLabel.style.marginBottom = "5px";

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

    section.appendChild(userLabel);
    section.appendChild(userInput);

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

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.marginRight = "8px";
    checkbox.checked = settings.savedBoards.some(
      (saved) => saved.id === board.id
    );

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

    const name = document.createElement("span");
    name.textContent = board.name;
    name.style.fontSize = "14px";

    leftSection.appendChild(checkbox);
    leftSection.appendChild(name);

    // Configure button
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

    configButton.onclick = async () => {
      try {
        configButton.style.opacity = "0.3";
        const config = await fetchBoardConfig(board.id);

        if (!config?.columnConfig?.columns) {
          throw new Error("Invalid board configuration");
        }

        // Close the settings modal before opening config modal
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
      const userInput = container.querySelector('input[type="text"]');
      const apiKeyInput = container.querySelector("#settings-api-key");
      const cancelledCheck = container.querySelector("#include-cancelled");
      const storyPointsField = container.querySelector("#story-points-field");

      const newSettings = {
        ...settings,
        currentUser: userInput.value,
        apiKey: apiKeyInput.value,
        storyPointsField: storyPointsField.value || "customfield_10034",
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
      const section = createCategorySection(category, columns, config);
      modal.appendChild(section);
    });

    // Add footer buttons
    modal.appendChild(createConfigModalFooter(modal, board.id, config));

    return modal;
  }

  function createCategorySection(category, allColumns, config) {
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
        createColumnItem(columnName, category.key, config)
      );
    });

    addButton.onclick = () => {
      // Get all selected columns from all categories
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
                createColumnItem(col, category.key, config)
              );
            }
          });
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

  function createColumnItem(columnName, category, config) {
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

    // Get all selected columns across all categories
    const allSelectedColumns = new Set();
    Object.values(settings.boardConfigs).forEach((config) => {
      Object.values(config).forEach((categoryColumns) => {
        categoryColumns.forEach((col) => allSelectedColumns.add(col));
      });
    });

    // Show only unselected columns
    allColumns.forEach((column) => {
      if (
        !allSelectedColumns.has(column.name) &&
        !selectedColumns.includes(column.name)
      ) {
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
        if (!allSelectedColumns.has(customValue)) {
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
