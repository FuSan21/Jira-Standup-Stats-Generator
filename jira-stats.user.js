// ==UserScript==
// @name         JIRA Stats
// @namespace    https://www.fusan.live
// @version      0.8.4
// @description  Show JIRA statistics
// @author       Md Fuad Hasan
// @match        https://auxosolutions.atlassian.net/*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-stats.user.js
// @downloadURL  https://raw.githubusercontent.com/FuSan21/Jira-Standup-Stats-Generator/refs/heads/main/jira-stats.user.js
// ==/UserScript==

(function () {
  "use strict";

  // Default values for settings
  const DEFAULT_SETTINGS = {
    currentJiraUser: "",
    completeStatusTo: ["Ready for Peer Review"],
    inProgress: ["In Progress", "Ready For Work"],
    includeCancelled: false,
    cancelledStatus: "Cancelled",
    timezone: "America/New_York",
  };

  // Load settings from local storage or use defaults
  let settings = null;

  async function loadSettings() {
    const savedSettings = localStorage.getItem("jiraStatsSettings");
    let settings = savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;

    settings.completeStatusTo = Array.isArray(settings.completeStatusTo)
      ? settings.completeStatusTo
      : DEFAULT_SETTINGS.completeStatusTo;

    settings.inProgress = Array.isArray(settings.inProgress)
      ? settings.inProgress
      : DEFAULT_SETTINGS.inProgress;

    settings.cancelledStatus =
      settings.cancelledStatus || DEFAULT_SETTINGS.cancelledStatus;
    settings.includeCancelled =
      settings.includeCancelled ?? DEFAULT_SETTINGS.includeCancelled;

    if (!settings.currentJiraUser || !settings.timezone) {
      try {
        const userData = await fetchCurrentUser();
        settings.currentJiraUser = userData.displayName;
        settings.timezone = userData.timezone;
        localStorage.setItem("jiraStatsSettings", JSON.stringify(settings));
      } catch (error) {
        console.error("Error fetching current user:", error);
      }
    }

    return settings;
  }

  function saveSettings(newSettings) {
    localStorage.setItem("jiraStatsSettings", JSON.stringify(newSettings));
    settings = newSettings;
  }

  // Create settings UI
  function createSettingsUI() {
    const container = document.createElement("div");
    container.style.cssText = `
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #ccc;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #f8f9fa;
    `;

    const title = document.createElement("h3");
    title.textContent = "Settings";
    title.style.cssText = `
      margin: 0 0 10px 0;
      font-size: 14px;
    `;
    container.appendChild(title);

    // Current User
    const userLabel = document.createElement("label");
    userLabel.textContent = "Current User:";
    userLabel.style.fontSize = "12px";
    const userInput = document.createElement("input");
    userInput.type = "text";
    userInput.value = settings.currentJiraUser;
    userInput.style.cssText = `
      width: 100%;
      padding: 5px;
      margin: 2px 0 8px;
      border: 1px solid #ccc;
      border-radius: 3px;
      font-size: 12px;
      box-sizing: border-box;
    `;

    // Status To
    const toLabel = document.createElement("label");
    toLabel.textContent = "Complete Status To (comma-separated):";
    toLabel.style.fontSize = "12px";
    const toInput = document.createElement("input");
    toInput.type = "text";
    toInput.value = settings.completeStatusTo.join(",");
    toInput.style.cssText = userInput.style.cssText;

    // Add Cancelled checkbox and input
    const cancelledContainer = document.createElement("div");
    cancelledContainer.style.marginTop = "10px";

    const cancelledCheck = document.createElement("input");
    cancelledCheck.type = "checkbox";
    cancelledCheck.id = "include-cancelled";
    cancelledCheck.checked = settings.includeCancelled;
    cancelledCheck.style.marginRight = "5px";

    const cancelledLabel = document.createElement("label");
    cancelledLabel.htmlFor = "include-cancelled";
    cancelledLabel.textContent = "Include Cancelled Status";
    cancelledLabel.style.fontSize = "12px";

    const cancelledInput = document.createElement("input");
    cancelledInput.type = "text";
    cancelledInput.value = settings.cancelledStatus || "Cancelled";
    cancelledInput.style.cssText = userInput.style.cssText;
    cancelledInput.style.marginTop = "5px";
    cancelledInput.style.display = settings.includeCancelled ? "block" : "none";
    cancelledInput.placeholder = "Cancelled status name";

    // Handle checkbox change
    cancelledCheck.onchange = () => {
      cancelledInput.style.display = cancelledCheck.checked ? "block" : "none";
    };

    cancelledContainer.appendChild(cancelledCheck);
    cancelledContainer.appendChild(cancelledLabel);
    cancelledContainer.appendChild(cancelledInput);

    // In Progress Statuses
    const inProgressLabel = document.createElement("label");
    inProgressLabel.textContent = "In Progress Statuses (comma-separated):";
    inProgressLabel.style.fontSize = "12px";
    const inProgressInput = document.createElement("input");
    inProgressInput.type = "text";
    inProgressInput.value = settings.inProgress.join(",");
    inProgressInput.style.cssText = userInput.style.cssText;

    // Save Button
    const saveButton = document.createElement("button");
    saveButton.textContent = "Save Settings";
    saveButton.style.cssText = `
      width: 100%;
      padding: 6px;
      margin-top: 10px;
      background: #0052CC;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      box-sizing: border-box;
    `;

    saveButton.onclick = () => {
      const newSettings = {
        currentJiraUser: userInput.value,
        completeStatusTo: toInput.value.split(",").map((s) => s.trim()),
        inProgress: inProgressInput.value.split(",").map((s) => s.trim()),
        includeCancelled: cancelledCheck.checked,
        cancelledStatus: cancelledInput.value.trim(),
        timezone: settings.timezone,
      };
      saveSettings(newSettings);
      // Show success message
      const originalText = saveButton.textContent;
      saveButton.textContent = "Saved!";

      const settingsContainer = container.parentElement;
      const gearIcon = settingsContainer.parentElement.querySelector(
        'button[title="Settings"]'
      );

      setTimeout(() => {
        saveButton.textContent = originalText;
        settingsContainer.remove();
        gearIcon.style.color = "";
      }, 1000);
    };

    container.appendChild(userLabel);
    container.appendChild(userInput);
    container.appendChild(toLabel);
    container.appendChild(toInput);
    container.appendChild(cancelledContainer);
    container.appendChild(inProgressLabel);
    container.appendChild(inProgressInput);
    container.appendChild(saveButton);

    return container;
  }

  // Wait for page to be fully loaded and stable
  function waitForHeader() {
    const headerSelector = 'nav[aria-label="Actions"] div[role="list"]';
    const maxAttempts = 10;
    let attempts = 0;

    function tryInit() {
      const header = document.querySelector(headerSelector);
      if (header) {
        setTimeout(init, 1000); // Add additional delay for stability
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(tryInit, 1000);
      } else {
        console.error("Could not find JIRA header after multiple attempts");
      }
    }

    // Start checking after page load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tryInit);
    } else {
      tryInit();
    }
  }

  // Create stats box
  function createStatsBox() {
    const box = document.createElement("div");
    box.style.cssText = `
        position: fixed;
        top: 56px;
        right: 20px;
        background: white;
        padding: 15px;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
        z-index: 9999;
        min-width: 250px;
        user-select: none;
    `;

    // Create header and buttons first
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: -15px -15px 10px -15px;
        padding: 10px 15px;
        background: #f4f5f7;
        border-radius: 5px 5px 0 0;
        border-bottom: 1px solid #ddd;
    `;

    const title = document.createElement("span");
    title.textContent = "Statistics";
    title.style.fontWeight = "bold";

    const buttonGroup = document.createElement("div");
    buttonGroup.style.display = "flex";
    buttonGroup.style.gap = "5px";

    // Add settings button
    const settingsButton = document.createElement("button");
    settingsButton.innerHTML = "⚙️";
    settingsButton.title = "Settings";
    settingsButton.style.cssText = `
        border: none;
        background: none;
        font-size: 16px;
        cursor: pointer;
        padding: 0 5px;
    `;

    // Add copy button
    const copyButton = document.createElement("button");
    copyButton.innerHTML = "📋";
    copyButton.title = "Copy statistics";
    copyButton.style.cssText = `
        border: none;
        background: none;
        font-size: 16px;
        cursor: pointer;
        padding: 0 5px;
    `;

    // Add close button
    const closeButton = document.createElement("button");
    closeButton.innerHTML = "×";
    closeButton.style.cssText = `
        border: none;
        background: none;
        font-size: 20px;
        cursor: pointer;
        padding: 0 5px;
    `;

    // Set up button click handlers
    let settingsUI = null;
    settingsButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (settingsUI) {
        settingsUI.remove();
        settingsUI = null;
        settingsButton.style.color = "";
      } else {
        settingsUI = createSettingsUI();
        box.insertBefore(settingsUI, controls);
        settingsButton.style.color = "#0052CC";
      }
    };

    copyButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const content = box.querySelector("#stats-content");
      const statsText = generateCopyText(content);
      navigator.clipboard.writeText(statsText).then(() => {
        const originalText = copyButton.innerHTML;
        copyButton.innerHTML = "✓";
        setTimeout(() => {
          copyButton.innerHTML = originalText;
        }, 1000);
      });
    };

    closeButton.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.remove();
      statsBox = null;
    };

    // Assemble the header
    buttonGroup.appendChild(settingsButton);
    buttonGroup.appendChild(copyButton);
    buttonGroup.appendChild(closeButton);
    header.appendChild(title);
    header.appendChild(buttonGroup);
    box.appendChild(header);

    // Add controls container
    const controls = document.createElement("div");
    controls.style.cssText = `
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid #ccc;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;

    // Add type selector
    const typeSelect = document.createElement("select");
    typeSelect.style.cssText = `
        padding: 5px;
        border-radius: 3px;
        border: 1px solid #ccc;
        width: 100%;
    `;

    // Add default option
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.text = "Select report type";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    typeSelect.appendChild(defaultOption);

    const typeOptions = [
      { value: "daily", text: "Daily Statistics" },
      { value: "weekly", text: "Weekly Statistics" },
    ];

    typeOptions.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.text = opt.text;
      typeSelect.appendChild(option);
    });

    // Add week selector (initially hidden)
    const weekSelect = document.createElement("select");
    weekSelect.style.cssText = `
        padding: 5px;
        border-radius: 3px;
        border: 1px solid #ccc;
        display: none;
        width: 100%;
    `;

    const weekOptions = [
      { value: "current", text: "Current Week" },
      { value: "last", text: "Last Week" },
      { value: "twoWeeks", text: "Two Weeks Ago" },
      { value: "threeWeeks", text: "Three Weeks Ago" },
      { value: "fourWeeks", text: "Four Weeks Ago" },
    ];

    weekOptions.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.text = opt.text;
      weekSelect.appendChild(option);
    });

    // Add date picker
    const datePicker = createDatePicker();

    // Add refresh button with initial disabled state
    const refreshButton = document.createElement("button");
    refreshButton.innerHTML = "Refresh";
    refreshButton.style.cssText = `
        padding: 5px 10px;
        border-radius: 3px;
        border: 1px solid #ccc;
        background: #fff;
        cursor: not-allowed;
        opacity: 0.6;
        width: 100%;
        margin-top: 5px;
    `;
    refreshButton.disabled = true;

    // Add change handlers for date and week selectors
    datePicker.querySelector("input").onchange = updateRefreshButton;
    weekSelect.onchange = updateRefreshButton;

    // Handle type selection change
    typeSelect.onchange = () => {
      if (typeSelect.value === "daily") {
        weekSelect.style.display = "none";
        datePicker.style.display = "block";
        weekSelect.value = ""; // Clear week selection
        datePicker.querySelector("input").value = ""; // Clear date selection
        title.textContent = "Daily Statistics";
      } else if (typeSelect.value === "weekly") {
        weekSelect.style.display = "inline-block";
        datePicker.style.display = "none";
        datePicker.querySelector("input").value = ""; // Clear date selection
        weekSelect.value = ""; // Clear week selection
        title.textContent = "Weekly Statistics";
      }
      updateRefreshButton();
    };

    // Function to check if selections are valid
    function updateRefreshButton() {
      const isValid =
        typeSelect.value &&
        ((typeSelect.value === "daily" &&
          datePicker.querySelector("input").value) ||
          (typeSelect.value === "weekly" && weekSelect.value));

      refreshButton.disabled = !isValid;
      refreshButton.style.cursor = isValid ? "pointer" : "not-allowed";
      refreshButton.style.opacity = isValid ? "1" : "0.6";
    }

    // Add click handler for refresh
    refreshButton.onclick = () => {
      if (refreshButton.disabled) return;

      const type = typeSelect.value;
      if (type === "daily") {
        fetchDailyStats(datePicker.querySelector("input").value, box);
      } else {
        fetchStats(weekSelect.value, box);
      }
    };

    // Assemble controls
    controls.appendChild(typeSelect);
    controls.appendChild(weekSelect);
    controls.appendChild(datePicker);
    controls.appendChild(refreshButton);
    box.appendChild(controls);

    // Add content container
    const content = document.createElement("div");
    content.id = "stats-content";
    box.appendChild(content);

    return box;
  }

  // Show loading state
  function showLoading(box) {
    const content = box.querySelector("#stats-content");
    content.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <p>Loading statistics...</p>
            <div class="loading-spinner" style="
                width: 30px;
                height: 30px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #3498db;
                border-radius: 50%;
                margin: 10px auto;
                animation: spin 1s linear infinite;
            "></div>
        </div>
    `;

    // Add spinner animation
    const style = document.createElement("style");
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
  }

  // Show error message
  function showError(box, message) {
    const content = box.querySelector("#stats-content");
    content.innerHTML = `
        <div style="text-align: center; padding: 20px; color: red;">
            <p>Error loading statistics:</p>
            <p>${message}</p>
            <button onclick="location.reload()" style="
                margin-top: 10px;
                padding: 5px 10px;
                border-radius: 3px;
                border: 1px solid #ccc;
                cursor: pointer;
            ">Retry</button>
        </div>
    `;
  }

  // Add function to fetch changelog
  async function fetchChangelog(key) {
    console.log(`Fetching changelog for ${key}`);
    const getCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(";").shift();
    };
    const atlToken = getCookie("atlassian.xsrf.token");

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://auxosolutions.atlassian.net/rest/api/3/issue/${key}/changelog`,
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
            if (response.status !== 200) {
              throw new Error(
                `HTTP ${response.status}: ${response.statusText}`
              );
            }
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject,
      });
    });
  }

  // Add helper function to convert UTC to user's timezone
  function convertToUserTimezone(date) {
    const userTimezone = settings.timezone || "America/New_York"; // Default to ET if not set
    return new Date(date).toLocaleString("en-US", { timeZone: userTimezone });
  }

  // Update getWeekBoundaries function
  function getWeekBoundaries(weekType) {
    const userTimezone = settings.timezone || "America/New_York";
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: userTimezone })
    );
    const currentDay = now.getDay();

    const sundayOffset = -currentDay;
    const currentWeekSunday = new Date(now);
    currentWeekSunday.setDate(now.getDate() + sundayOffset);
    currentWeekSunday.setHours(0, 0, 0, 0);

    let targetStart = new Date(currentWeekSunday);

    if (weekType !== "current") {
      const weeksToSubtract = {
        last: 7,
        twoWeeks: 14,
        threeWeeks: 21,
        fourWeeks: 28,
      }[weekType];
      targetStart.setDate(targetStart.getDate() - weeksToSubtract);
    }

    const targetEnd = new Date(targetStart);
    targetEnd.setDate(targetStart.getDate() + 7);

    console.log("Week boundaries:", {
      weekType,
      startDate: targetStart.toLocaleString("en-US", {
        timeZone: userTimezone,
      }),
      endDate: targetEnd.toLocaleString("en-US", { timeZone: userTimezone }),
      timezone: userTimezone,
    });

    return { start: targetStart, end: targetEnd };
  }

  function processTicketInfo(item, stats, weekType, weekBoundaries, changelog) {
    const type = item.getElementsByTagName("type")[0].textContent;
    const created = new Date(
      item.getElementsByTagName("created")[0].textContent
    );
    const summary = item.getElementsByTagName("summary")[0].textContent;
    const priority = item.getElementsByTagName("priority")[0].textContent;
    const status = item.getElementsByTagName("status")[0].textContent;

    // Get story points
    let points = 0;
    const customfields = item.getElementsByTagName("customfield");
    for (let field of customfields) {
      if (
        field.getAttribute("key") ===
        "com.atlassian.jira.plugin.system.customfieldtypes:float"
      ) {
        const values = field.getElementsByTagName("customfieldvalue");
        if (values && values.length > 0) {
          points = parseFloat(values[0].textContent) || 0;
        }
      }
    }

    // Process weekly stats if needed
    if (weekType !== "daily" && changelog) {
      const assignmentChange = changelog.values.find((change) =>
        change.items.some(
          (item) =>
            item.field === "assignee" &&
            item.toString === settings.currentJiraUser
        )
      );

      if (assignmentChange) {
        const assignmentDate = new Date(
          convertToUserTimezone(assignmentChange.created)
        );
        console.log(
          `Assignment details for ${
            item.getElementsByTagName("key")[0].textContent
          }:`,
          {
            date: assignmentDate.toLocaleString("en-US", {
              timeZone: settings.timezone,
            }),
            beforeWeekStart: assignmentDate < weekBoundaries.start,
            beforeWeekEnd: assignmentDate < weekBoundaries.end,
            timezone: settings.timezone,
          }
        );

        if (assignmentDate < weekBoundaries.start) {
          console.log(
            `${
              item.getElementsByTagName("key")[0].textContent
            } is a carryover ticket`
          );
          stats.carryover++;
        } else if (assignmentDate < weekBoundaries.end) {
          console.log(
            `${item.getElementsByTagName("key")[0].textContent} is a new ticket`
          );
          stats.newTickets++;
        }
      }
    }

    const ticketInfo = {
      key: item.getElementsByTagName("key")[0].textContent,
      type,
      status,
      points,
      created,
      summary,
      priority,
    };
    stats.tickets.push(ticketInfo);
    stats.totalPoints += points;
    stats.completedPoints += points;
    if (type === "Bug") stats.bugs++;
    else stats.userStories++;
  }

  async function processXMLData(xmlText, weekType = "current") {
    console.log(`Processing XML data for week type: ${weekType}`);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const items = xmlDoc.getElementsByTagName("item");

    const stats = {
      tickets: [],
      carryover: 0,
      newTickets: 0,
      completed: items.length,
      bugs: 0,
      userStories: 0,
      totalPoints: 0,
      completedPoints: 0,
    };

    const weekBoundaries =
      weekType === "daily" ? null : getWeekBoundaries(weekType);
    if (weekBoundaries) {
      console.log("Week boundaries:", {
        start: weekBoundaries.start.toISOString(),
        end: weekBoundaries.end.toISOString(),
      });
    }

    for (let item of items) {
      const key = item.getElementsByTagName("key")[0].textContent;
      const status = item.getElementsByTagName("status")[0].textContent;
      console.log(`\nProcessing ticket ${key}:`);

      if (settings.includeCancelled && status === settings.cancelledStatus) {
        processTicketInfo(item, stats, weekType, weekBoundaries, null);
        continue;
      }

      try {
        const changelog = await fetchChangelog(key);
        console.log(`Changelog for ${key}:`, changelog);

        const validStatusChange = changelog.values.find((change) => {
          return change.items.some((item) => {
            return (
              item.field === "status" &&
              change.author.displayName === settings.currentJiraUser &&
              settings.completeStatusTo.includes(item.toString)
            );
          });
        });

        if (!validStatusChange) {
          console.log(
            `${key}: No valid status change by ${settings.currentJiraUser} found`
          );
          continue;
        }

        processTicketInfo(item, stats, weekType, weekBoundaries, changelog);
      } catch (error) {
        console.error(`Error processing changelog for ${key}:`, error);
      }
    }

    stats.completed = stats.tickets.length;
    console.log("\nFinal stats:", stats);
    return stats;
  }

  // Update stats box content
  function updateStatsBox(box, stats) {
    const content = box.querySelector("#stats-content");
    const type = content.getAttribute("data-type") || "weekly";
    const titlePrefix = type === "daily" ? "Daily" : "Weekly";

    content.innerHTML = `
        <h3>${titlePrefix} Statistics</h3>
        ${
          type === "weekly"
            ? `
            <div style="margin-bottom: 15px;">
                <p><strong>Ticket Counts:</strong></p>
                <ul id="stats-summary" style="list-style: none; padding-left: 10px;">
                    <li>Carryover Tickets: ${stats.carryover}</li>
                    <li>New Tickets: ${stats.newTickets}</li>
                    <li>Completed Tickets: ${stats.completed}</li>
                    <li>Bug Tickets: ${stats.bugs}</li>
                    <li>User Story Tickets: ${stats.userStories}</li>
                </ul>
            </div>
            <div style="margin-bottom: 15px;">
                <p><strong>Story Points:</strong></p>
                <ul id="points-summary" style="list-style: none; padding-left: 10px;">
                    <li>Total Points: ${stats.totalPoints}</li>
                    <li>Completed Points: ${stats.completedPoints}</li>
                </ul>
            </div>
            `
            : `
            <div style="margin-bottom: 15px;">
                <p><strong>Summary:</strong></p>
                <ul id="stats-summary" style="list-style: none; padding-left: 10px;">
                    <li>Total Tickets: ${stats.completed}</li>
                    <li>Points Completed: ${stats.completedPoints}</li>
                </ul>
            </div>
            `
        }
        <div>
            <p><strong>Tickets:</strong></p>
            <ul id="tickets-list" style="max-height: 200px; overflow-y: auto; margin: 0; padding-left: 20px;">
                ${stats.tickets
                  .map(
                    (t) =>
                      `<li title="${encodeHTMLEntities(t.summary)}">${t.key} (${
                        t.type
                      }) [${t.priority}] - ${t.status}${
                        t.points ? ` [${t.points}pts]` : ""
                      }</li>`
                  )
                  .join("")}
            </ul>
        </div>
    `;
  }

  // Get JQL query based on week selection
  function getJqlQuery(weekType) {
    let statusList = [...settings.completeStatusTo];
    if (settings.includeCancelled && settings.cancelledStatus) {
      statusList.push(settings.cancelledStatus);
    }

    const baseQuery =
      'assignee WAS currentUser() AND status changed TO ("' +
      statusList.join('", "') +
      '")';
    const notInProgress =
      ' AND status NOT IN ("' + settings.inProgress.join('", "') + '")';

    if (weekType === "current") {
      return `${baseQuery} DURING (startOfWeek(), endOfWeek())${notInProgress}`;
    }

    // Map weekType to number of weeks ago
    const weeksAgo = {
      last: 1,
      twoWeeks: 2,
      threeWeeks: 3,
      fourWeeks: 4,
    }[weekType];

    return `${baseQuery} DURING (startOfWeek(-${weeksAgo}), endOfWeek(-${weeksAgo}w))${notInProgress}`;
  }

  // Update fetchStats to pass weekType
  function fetchStats(weekType, statsBox) {
    showLoading(statsBox);
    const content = statsBox.querySelector("#stats-content");
    content.setAttribute("data-type", "weekly");

    const jqlQuery = getJqlQuery(weekType);

    // Get CSRF token from cookie
    const getCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(";").shift();
    };
    const atlToken = getCookie("atlassian.xsrf.token");

    // Format JQL query
    const formattedJql = jqlQuery
      .replace(/ /g, "+")
      .replace(/"/g, "%22")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/,/g, "%2C");

    const xmlUrl = `https://auxosolutions.atlassian.net/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=${formattedJql}&atl_token=${atlToken}&tempMax=1000`;

    // Fetch XML data
    GM_xmlhttpRequest({
      method: "GET",
      url: xmlUrl,
      headers: {
        Accept: "application/xml",
        "X-Requested-With": "XMLHttpRequest",
        "X-AUSERNAME":
          document.querySelector('meta[name="ajs-remote-user"]')?.content || "",
      },
      withCredentials: true,
      onload: async function (response) {
        try {
          if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const stats = await processXMLData(response.responseText, weekType);
          updateStatsBox(statsBox, stats);
        } catch (error) {
          console.error("Error processing JIRA data:", error);
          showError(statsBox, error.message);
        }
      },
      onerror: function (error) {
        console.error("Network error:", error);
        showError(
          statsBox,
          "Failed to fetch data. Please check your connection."
        );
      },
    });
  }

  // Create header button
  function createHeaderButton() {
    // Create the outer container structure
    const container = document.createElement("div");
    container.setAttribute("role", "listitem");
    container.className = "_kqswh2mm _1e0c1txw";

    const button = document.createElement("button");
    button.className =
      "_mizu194a _1ah31bk5 _ra3xnqa1 _128m1bk5 _1cvmnqa1 _4davt94y _19itglyw _vchhusvi _r06hglyw _80omtlke _2rkosqtm _11c82smr _v5649dqc _189eidpf _1rjc12x7 _1e0c116y _1bsbviql _p12f1osq _kqswh2mm _4cvr1q9y _1bah1h6o _gy1p1b66 _1o9zidpf _4t3iviql _k48p1wq8 _y4tize3t _bozgze3t _y3gn1h6o _s7n4nkob _14mj1kw7 _9v7aze3t _1tv3nqa1 _39yqe4h9 _11fnglyw _18postnw _bfhk1w7a _syaz1gjq _10531gjq _f8pj1gjq _30l31gjq _9h8h1gjq _irr34mfv _1di619qy _4bfu18uv _1hmsglyw _ajmmnqa1 _1a3b18uv _4fprglyw _5goinqa1 _9oik18uv _1bnxglyw _jf4cnqa1 _1nrm18uv _c2waglyw _1iohnqa1";
    button.setAttribute("aria-label", "Statistics");
    button.setAttribute("tabindex", "0");
    button.setAttribute("type", "button");

    // Create spans for icon structure
    const outerSpan = document.createElement("span");
    outerSpan.className =
      "_v564g17y _1e0c1txw _16jlidpf _1o9zidpf _1wpz1h6o _1wybidpf _vwz4idpf _uiztglyw";

    const iconSpan = document.createElement("span");
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.style.cssText =
      "color: currentcolor; font-size: 16px; display: inline-block; width: 16px; height: 16px; line-height: 16px; text-align: center;";
    iconSpan.className =
      "_1e0c1o8l _vchhusvi _1o9zidpf _vwz4kb7n _y4ti1igz _bozg1mb9 _12va18uv _jcxd1r8n";
    iconSpan.innerHTML = "📊";

    const textSpan = document.createElement("span");
    textSpan.className =
      "_ca0qidpf _u5f3idpf _n3tdidpf _19bvidpf _19itidpf _1reo15vq _18m915vq _1bsbt94y _4t3it94y _kqswstnw _ogto7mnp _uiztglyw _o5721q9c";
    textSpan.textContent = "Statistics";

    // Assemble the structure
    outerSpan.appendChild(iconSpan);
    outerSpan.appendChild(textSpan);
    button.appendChild(outerSpan);
    container.appendChild(button);

    return container;
  }

  // Main function
  function init() {
    console.log("Statistics: Attempting to inject button");
    // Find the secondary actions list using the new structure
    const actionsList = document.querySelector(
      'nav[aria-label="Actions"] div[role="list"]'
    );
    if (!actionsList) {
      console.error("Statistics: Could not find secondary actions list");
      return;
    }

    // Check if button already exists
    if (actionsList.querySelector('[aria-label="Statistics"]')) {
      console.log("Statistics: Button already exists, skipping injection");
      return;
    }

    // Insert button before the notifications container
    console.log("Statistics: Injecting button");
    const statsButton = createHeaderButton();
    actionsList.insertBefore(statsButton, actionsList.firstChild);

    // Move statsBox to higher scope
    let statsBox = null;

    // Update close button handler in createStatsBox
    const originalCreateStatsBox = createStatsBox;
    createStatsBox = function () {
      const box = originalCreateStatsBox();
      const closeButton = box.querySelector("button:last-child");
      closeButton.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        box.remove();
        statsBox = null; // Clear the reference
      };
      return box;
    };

    // Add click handler
    statsButton.querySelector("button").onclick = () => {
      if (statsBox) {
        statsBox.remove();
        statsBox = null;
      } else {
        statsBox = createStatsBox();
        // Add initial content
        const content = statsBox.querySelector("#stats-content");
        content.innerHTML = `
          <div style="text-align: center; padding: 20px;">
            <p>Click refresh to load statistics</p>
          </div>
        `;
        document.body.appendChild(statsBox);
      }
    };
  }

  // Watch for page changes
  function setupPageChangeObserver() {
    let isProcessing = false;

    // Create an observer instance
    const observer = new MutationObserver((mutations) => {
      if (isProcessing) return;
      isProcessing = true;

      // Check if we need to reinject the button
      const actionsList = document.querySelector(
        'nav[aria-label="Actions"] div[role="list"]'
      );
      if (
        actionsList &&
        !actionsList.querySelector('[aria-label="Statistics"]')
      ) {
        console.log("Statistics: Reinjecting stats button after page change");
        init();
      }

      setTimeout(() => {
        isProcessing = false;
      }, 100);
    });

    // Start observing the document with the configured parameters
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function start() {
    await initializeSettings();
    waitForHeader();
    setupPageChangeObserver();
  }

  start();

  // Update the generateCopyText function
  function generateCopyText(content) {
    const stats = {};
    const type =
      content.closest("#stats-content")?.getAttribute("data-type") || "weekly";
    const titlePrefix = type === "daily" ? "Daily" : "Weekly";

    // Extract ticket counts from stats summary
    content
      .querySelector("#stats-summary")
      .querySelectorAll("li")
      .forEach((li) => {
        const text = li.textContent;
        if (text.includes(":")) {
          const [key, value] = text.split(":");
          stats[key.trim()] = value.trim();
        }
      });

    // Extract points from points summary if weekly
    if (type === "weekly") {
      content
        .querySelector("#points-summary")
        .querySelectorAll("li")
        .forEach((li) => {
          const text = li.textContent;
          if (text.includes(":")) {
            const [key, value] = text.split(":");
            stats[key.trim()] = value.trim();
          }
        });
    }

    // Format text
    let text = `${titlePrefix} Statistics Summary\n\n`;

    if (type === "weekly") {
      text += "Ticket Counts:\n";
      if (stats["Carryover Tickets"])
        text += `- Carryover Tickets: ${stats["Carryover Tickets"]}\n`;
      if (stats["New Tickets"])
        text += `- New Tickets: ${stats["New Tickets"]}\n`;
      if (stats["Completed Tickets"])
        text += `- Completed Tickets: ${stats["Completed Tickets"]}\n`;
      if (stats["Bug Tickets"])
        text += `- Bug Tickets: ${stats["Bug Tickets"]}\n`;
      if (stats["User Story Tickets"])
        text += `- User Story Tickets: ${stats["User Story Tickets"]}\n`;

      text += "\nStory Points:\n";
      if (stats["Total Points"])
        text += `- Total Points: ${stats["Total Points"]}\n`;
      if (stats["Completed Points"])
        text += `- Completed Points: ${stats["Completed Points"]}\n`;
    } else {
      text += "Summary:\n";
      if (stats["Total Tickets"])
        text += `- Total Tickets: ${stats["Total Tickets"]}\n`;
      if (stats["Points Completed"])
        text += `- Points Completed: ${stats["Points Completed"]}\n`;
    }
    text += "\n- Blocked Tickets: 0\n";
    text += "- Priority Level /Blocker Impact: N/A\n";

    // Add tickets list with priority
    text += "\nTickets:\n";
    content
      .querySelector("#tickets-list")
      .querySelectorAll("li")
      .forEach((li) => {
        text += `- ${li.textContent}\n`;
      });

    return text;
  }

  // Add this function to create date picker
  function createDatePicker() {
    const container = document.createElement("div");
    container.style.cssText = `
        margin-top: 10px;
        display: none;
    `;

    const datePicker = document.createElement("input");
    datePicker.type = "date";
    datePicker.style.cssText = `
        padding: 5px;
        border-radius: 3px;
        border: 1px solid #ccc;
        width: 100%;
    `;

    // Remove default value setting
    datePicker.value = ""; // Start with empty value

    container.appendChild(datePicker);
    return container;
  }

  // Add function to fetch daily statistics
  function fetchDailyStats(date, statsBox) {
    showLoading(statsBox);
    const content = statsBox.querySelector("#stats-content");
    content.setAttribute("data-type", "daily");

    let statusList = [...settings.completeStatusTo];
    if (settings.includeCancelled && settings.cancelledStatus) {
      statusList.push(settings.cancelledStatus);
    }

    const baseQuery = `assignee WAS currentUser() AND status changed TO ("${statusList.join(
      '", "'
    )}")`;
    const notInProgress =
      ' AND status NOT IN ("' + settings.inProgress.join('", "') + '")';
    const jqlQuery = baseQuery + ` ON "${date}"` + notInProgress;

    // Get CSRF token from cookie
    const getCookie = (name) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(";").shift();
    };
    const atlToken = getCookie("atlassian.xsrf.token");

    // Format JQL query
    const formattedJql = jqlQuery
      .replace(/ /g, "+")
      .replace(/"/g, "%22")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/,/g, "%2C");

    const xmlUrl = `https://auxosolutions.atlassian.net/sr/jira.issueviews:searchrequest-xml/temp/SearchRequest.xml?jqlQuery=${formattedJql}&atl_token=${atlToken}&tempMax=1000`;

    // Fetch XML data
    GM_xmlhttpRequest({
      method: "GET",
      url: xmlUrl,
      headers: {
        Accept: "application/xml",
        "X-Requested-With": "XMLHttpRequest",
        "X-AUSERNAME":
          document.querySelector('meta[name="ajs-remote-user"]')?.content || "",
      },
      withCredentials: true,
      onload: async function (response) {
        try {
          if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          const stats = await processXMLData(response.responseText, "daily");
          updateStatsBox(statsBox, stats);
        } catch (error) {
          console.error("Error processing JIRA data:", error);
          showError(statsBox, error.message);
        }
      },
      onerror: function (error) {
        console.error("Network error:", error);
        showError(
          statsBox,
          "Failed to fetch data. Please check your connection."
        );
      },
    });
  }

  // Add function to fetch current user
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
            if (response.status !== 200) {
              throw new Error(
                `HTTP ${response.status}: ${response.statusText}`
              );
            }
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

  // Update the initialization to handle async loadSettings
  async function initializeSettings() {
    settings = await loadSettings();
  }

  function encodeHTMLEntities(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
