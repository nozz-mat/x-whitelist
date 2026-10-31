(() => {
  "use strict";

  if (window.__XWL_INITIALIZED__) return;
  window.__XWL_INITIALIZED__ = true;

  const KEY = "xwl_allowed_users";
  const isImportPage =
    new URLSearchParams(location.search).get("xwl_import") === "1";

  let allowed = new Set();
  let initialized = false;
  let scheduled = false;
  let observer;

  const normalize = value =>
    String(value || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

  const isValidUsername = name =>
    /^[a-z0-9_]{1,15}$/.test(name);

  const reserved = new Set([
    "home",
    "explore",
    "notifications",
    "messages",
    "i",
    "settings",
    "search",
    "compose",
    "bookmarks",
    "lists",
    "communities",
    "premium",
    "verified_followers",
    "tos",
    "privacy",
    "login",
    "logout",
    "signup",
    "account",
    "hashtag"
  ]);

  // ==================================
  // 設定の取得
  // ==================================

  async function loadSettings() {
    const data = await chrome.storage.local.get({
      [KEY]: []
    });

    allowed = new Set(
      data[KEY]
        .map(normalize)
        .filter(isValidUsername)
    );

    initialized = true;
    schedule();
  }

  // ==================================
  // 許可リスト保存
  // ==================================

  async function saveAllowed() {
    await chrome.storage.local.set({
      [KEY]: [...allowed]
    });
  }

  // ==================================
  // URLからユーザー名を取得
  // ==================================

  function getUsername(href) {
    try {
      const url = new URL(href, location.origin);

      if (url.origin !== location.origin) {
        return null;
      }

      const parts = url.pathname.split("/")
        .filter(Boolean);

      if (!parts.length) return null;

      const name = normalize(parts[0]);

      if (
        !isValidUsername(name) ||
        reserved.has(name)
      ) {
        return null;
      }

      return name;
    } catch {
      return null;
    }
  }

  function isAllowed(name) {
    return !!name && allowed.has(name);
  }

  // ==================================
  // 投稿者の取得
  // ==================================

  function getAuthor(element) {
    const area = element.querySelector(
      '[data-testid="User-Name"]'
    );

    if (!area) return null;

    for (const link of area.querySelectorAll("a[href]")) {
      const name = getUsername(
        link.getAttribute("href")
      );

      if (name) return name;
    }

    return null;
  }

  // ==================================
  // 引用投稿の取得
  // ==================================

  function getQuoteCards(article) {
    const results = new Set();

    const selectors = [
      '[data-testid="quoteTweet"]',
      '[data-testid="tweet"]'
    ];

    for (const selector of selectors) {
      article.querySelectorAll(selector)
        .forEach(element => {
          if (
            element === article ||
            element.closest("article") !== article
          ) {
            return;
          }

          if (getAuthor(element)) {
            results.add(element);
          }
        });
    }

    return [...results];
  }

  // ==================================
  // 投稿の判定
  // ==================================

  function checkArticle(article) {
    const author = getAuthor(article);

    // 投稿者不明は非表示
    if (!author || !isAllowed(author)) {
      return false;
    }

    // 引用元の判定
    const quotes = getQuoteCards(article);

    for (const quote of quotes) {
      const quoteAuthor = getAuthor(quote);

      quote.classList.toggle(
        "xwl-hidden-quote",
        !isAllowed(quoteAuthor)
      );
    }

    return true;
  }

  // ==================================
  // 投稿のフィルタリング
  // ==================================

  function filterArticles() {
    if (!initialized) return;

    filterPrimaryNavigation();
    disableRecommendedTimeline();

    const main = document.querySelector(
      '[data-testid="primaryColumn"]'
    );

    if (!main) {
      document.body.classList.remove("xwl-loading");
      return;
    }

    main.querySelectorAll("article").forEach(article => {
      const visible = checkArticle(article);

      article.classList.toggle(
        "xwl-hidden",
        !visible
      );
    });

    filterProfileLinks();
    filterRecommendations();

    document.body.classList.remove("xwl-loading");
  }

  function disableRecommendedTimeline() {
    if (isImportPage) return;

    document.querySelectorAll('[role="tablist"]').forEach(tabList => {
      const tabs = [...tabList.querySelectorAll(
        '[role="tab"], a[href], button'
      )];
      const recommended = tabs.find(tab =>
        /(おすすめ|for you)/i.test(
          [
            tab.getAttribute("aria-label"),
            tab.getAttribute("title"),
            tab.textContent
          ].filter(Boolean).join(" ").trim()
        )
      );
      const following = tabs.find(tab =>
        /(フォロー中|following)/i.test(
          [
            tab.getAttribute("aria-label"),
            tab.getAttribute("title"),
            tab.textContent
          ].filter(Boolean).join(" ").trim()
        )
      );

      if (!recommended) return;

      const selectedRecommended =
        recommended.getAttribute("aria-selected") === "true" ||
        recommended.querySelector('[aria-selected="true"]') !== null;

      recommended.classList.add("xwl-recommended-tab-hidden");

      if (selectedRecommended && following) {
        following.click();
      }
    });
  }

  // ==================================
  // 未許可アカウントのリンクを遮断
  // ==================================

  function filterProfileLinks() {
    document.querySelectorAll("a[href]")
      .forEach(link => {
        if (isImportPage && link.closest('[data-testid="UserCell"]')) {
          link.classList.remove("xwl-blocked-link");
          link.removeAttribute("aria-hidden");
          link.removeAttribute("tabindex");
          return;
        }

        const username = getUsername(
          link.getAttribute("href")
        );

        if (!username) return;

        link.classList.toggle(
          "xwl-blocked-link",
          !isAllowed(username)
        );

        if (!isAllowed(username)) {
          link.setAttribute("aria-hidden", "true");
          link.setAttribute("tabindex", "-1");
        } else {
          link.removeAttribute("aria-hidden");
          link.removeAttribute("tabindex");
        }
      });
  }

  // ==================================
  // おすすめ・関連ユーザー
  // ==================================

  function filterRecommendations() {
    const selectors = [
      '[data-testid="sidebarColumn"]',
      '[data-testid="WhoToFollow"]',
      '[data-testid="ConnectTab"]',
      '[data-testid="DMDrawer"]'
    ];

    if (!isImportPage) {
      selectors.push('[data-testid="UserCell"]');
    }

    document.querySelectorAll(
      selectors.join(",")
    ).forEach(element => {
      element.classList.add("xwl-hidden-ui");
    });
  }

  // ==================================
  // フォロー中アカウントの一括登録
  // ==================================

  function showImportStatus(message, finished = false, error = false) {
    let panel = document.getElementById("xwl-import-status");

    if (!panel) {
      panel = document.createElement("section");
      panel.id = "xwl-import-status";
      panel.className = "xwl-import-status";
      panel.setAttribute("role", "status");

      const text = document.createElement("div");
      text.id = "xwl-import-status-text";
      panel.appendChild(text);

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "閉じる";
      close.addEventListener("click", () => panel.remove());
      panel.appendChild(close);

      document.body.appendChild(panel);
    }

    const text = panel.querySelector("#xwl-import-status-text");
    text.textContent = message;
    panel.dataset.error = String(error);
    panel.querySelector("button").hidden = !finished;
  }

  function getFollowingAccounts(root) {
    const usernames = new Set();

    root.querySelectorAll('[data-testid="UserCell"]')
      .forEach(cell => {
        cell.classList.remove("xwl-hidden", "xwl-hidden-ui");
        cell.style.setProperty("visibility", "visible", "important");
        cell.style.removeProperty("display");

        const links = cell.querySelectorAll("a[href]");
        links.forEach(link => {
          link.classList.remove("xwl-blocked-link");
          link.style.setProperty("visibility", "visible", "important");
          link.style.setProperty("pointer-events", "auto", "important");
          link.removeAttribute("aria-hidden");
          link.removeAttribute("tabindex");
        });

        for (const link of links) {
          if (link.closest('[data-testid*="Description"], [data-testid*="Bio"]')) {
            continue;
          }

          try {
            const url = new URL(link.href, location.origin);
            const parts = url.pathname.split("/").filter(Boolean);

            if (url.origin !== location.origin || parts.length !== 1) continue;

            const username = normalize(parts[0]);
            if (isValidUsername(username) && !reserved.has(username)) {
              usernames.add(username);
              break;
            }
          } catch (error) {
            console.warn("[XWL] Skipped an invalid profile link", error);
          }
        }
      });

    return usernames;
  }

  function getCurrentUsername() {
    const profileLinks = document.querySelectorAll([
      '[data-testid="AppTabBar_Profile_Link"]',
      'a[aria-label="Profile"]',
      'a[aria-label="プロフィール"]',
      'a[data-testid*="Profile"]',
      '[data-testid="SideNav_AccountSwitcher_Button"] a[href]'
    ].join(","));

    for (const link of profileLinks) {
      const username = getUsername(link.getAttribute("href"));
      if (username) return username;
    }

    const accountSwitcher = document.querySelector(
      '[data-testid="SideNav_AccountSwitcher_Button"]'
    );
    const handle = accountSwitcher?.textContent.match(
      /@([a-z0-9_]{1,15})/i
    );
    if (handle) return normalize(handle[1]);

    const currentPathUsername = getUsername(location.pathname);
    return currentPathUsername || null;
  }

  function findFollowingScroller(main) {
    for (let element = main; element && element !== document.body; element = element.parentElement) {
      const overflowY = getComputedStyle(element).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight + 20
      ) {
        return element;
      }
    }

    return document.scrollingElement;
  }

  function scrollFollowingList(scroller) {
    if (scroller === document.scrollingElement) {
      window.scrollTo(0, scroller.scrollHeight);
      return;
    }

    scroller.scrollTop = scroller.scrollHeight;
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function importFollowingAccounts() {
    document.body.classList.add("xwl-importing");
    showImportStatus("フォロー中一覧を読み込んでいます…");

    try {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("xwl_import");
      history.replaceState(
        history.state,
        "",
        `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`
      );

      let root = null;
      for (let attempt = 0; attempt < 30 && !root; attempt += 1) {
        root = document.querySelector('[data-testid="primaryColumn"]');
        if (!root) await wait(1000);
      }

      if (!root) {
        throw new Error("X following page did not render its main content");
      }

      const usernames = new Set();
      let idleRounds = 0;
      let foundUserCells = false;

      for (let round = 0; round < 600 && idleRounds < 8; round += 1) {
        const previousCount = usernames.size;
        const cells = root.querySelectorAll('[data-testid="UserCell"]');
        foundUserCells = foundUserCells || cells.length > 0;
        getFollowingAccounts(root).forEach(name => usernames.add(name));

        if (usernames.size > previousCount) {
          idleRounds = 0;
          showImportStatus(`${usernames.size}件のアカウントを読み込みました…`);
        } else {
          idleRounds += 1;
        }

        scrollFollowingList(findFollowingScroller(root));
        await wait(1000);
      }

      if (usernames.size === 0) {
        throw new Error(
          foundUserCells
            ? "Following rows were present but no account handles matched"
            : "No following user rows appeared"
        );
      }

      const stored = await chrome.storage.local.get({ [KEY]: [] });
      const existing = new Set(
        stored[KEY].map(normalize).filter(isValidUsername)
      );
      const beforeCount = existing.size;

      usernames.forEach(name => existing.add(name));
      await chrome.storage.local.set({ [KEY]: [...existing] });

      const addedCount = existing.size - beforeCount;
      showImportStatus(
        `完了：${usernames.size}件を確認し、新たに${addedCount}件を許可リストへ登録しました。`,
        true
      );
    } catch (error) {
      console.error("[XWL] Following import failed", error);
      const message =
        error.message === "No following user rows appeared"
          ? "フォロー中一覧のユーザー行が見つかりません。Xのフォロー中ページが表示されているか確認してください。"
          : error.message === "Following rows were present but no account handles matched"
            ? "ユーザー行は見つかりましたが、ユーザー名を取得できませんでした。Xの画面構成が変わった可能性があります。"
            : "一覧を読み込めませんでした。Xのフォロー中ページが表示されているか確認してください。";
      showImportStatus(
        message,
        true,
        true
      );
    }
  }

  // ==================================
  // 左側メニュー
  // ホームと「もっと見る」だけ表示
  // ==================================

  function filterPrimaryNavigation() {
    const nav = document.querySelector(
      'nav[aria-label="Primary"]'
    ) || document.querySelector(
      'nav a[href="/home"], nav [data-testid="AppTabBar_Home_Link"]'
    )?.closest("nav");

    if (!nav) return;

    const homeItem = nav.querySelector(
      'a[href="/home"], [data-testid="AppTabBar_Home_Link"]'
    );

    const moreSelector = [
      '[data-testid*="More"]',
      'a[href="/i/overflow"]',
      'a[href="/i/more"]',
      '[aria-label*="More" i]',
      '[aria-label*="もっと見る"]',
      '[title*="もっと見る"]',
      '[title*="More" i]'
    ].join(",");
    const more = nav.querySelector(moreSelector) ||
      [...nav.querySelectorAll('a[href], button, [role="button"], [role="link"]')]
        .find(item => {
          const label = [
            item.getAttribute("aria-label"),
            item.getAttribute("title"),
            item.textContent
          ].join(" ").trim();
          return /(^|\s)(more|もっと見る)(\s|$)/i.test(label);
        });

    for (const item of [homeItem, more]) {
      for (let ancestor = item; ancestor && ancestor !== nav; ancestor = ancestor.parentElement) {
        ancestor.classList.remove("xwl-hidden-ui", "xwl-nav-hidden");
        ancestor.style.removeProperty("display");
      }
    }

    nav.querySelectorAll(
      'a[href], button, [role="button"], [role="link"], [data-testid^="AppTabBar_"]'
    )
      .forEach(item => {
        const keep =
          (homeItem && (
            item === homeItem ||
            item.contains(homeItem) ||
            homeItem.contains(item)
          )) ||
          (more && (
            item === more ||
            item.contains(more) ||
            more.contains(item)
          ));

        if (keep) {
          item.classList.remove("xwl-nav-hidden");
          item.style.removeProperty("display");
        } else {
          item.classList.add("xwl-nav-hidden");
        }
      });
  }

  // ==================================
  // フォロー操作の検知
  // ==================================

  function findUserContainer(button) {
    return (
      button.closest('[data-testid="UserCell"]') ||
      button.closest('[data-testid="UserProfileHeader_Items"]') ||
      button.closest('[data-testid="primaryColumn"]')
    );
  }

  function getUserFromContainer(container) {
    if (!container) return null;

    const links = container.querySelectorAll("a[href]");

    for (const link of links) {
      const username = getUsername(
        link.getAttribute("href")
      );

      if (username) return username;
    }

    return null;
  }

  function getFollowAction(button) {
    const testid = button.getAttribute("data-testid") || "";
    const label = (
      button.getAttribute("aria-label") ||
      button.textContent ||
      ""
    ).trim().toLowerCase();

    if (
      testid === "follow" ||
      label === "follow" ||
      label === "フォロー"
    ) {
      return "follow";
    }

    if (
      testid === "unfollow" ||
      label === "unfollow" ||
      label === "フォロー解除"
    ) {
      return "unfollow";
    }

    return null;
  }

  // ボタン操作をユーザーが行った場合だけ監視
  document.addEventListener("click", event => {
    const button = event.target.closest("button");

    if (!button) return;

    const action = getFollowAction(button);

    if (!action) return;

    const container = findUserContainer(button);
    const username = getUserFromContainer(container);

    if (!username) return;

    // クリック前の状態を保存
    setTimeout(async () => {
      const currentButtons =
        container?.querySelectorAll("button") || [];

      const currentActions = [
        ...currentButtons
      ].map(getFollowAction);

      const succeeded =
        action === "follow"
          ? currentActions.includes("unfollow")
          : currentActions.includes("follow");

      if (!succeeded) return;

      if (action === "follow") {
        allowed.add(username);
      } else {
        allowed.delete(username);
      }

      try {
        await saveAllowed();
        schedule();
      } catch (error) {
        console.error("[XWL] Save failed", error);
      }
    }, 1200);

  }, true);

  // ==================================
  // 未許可プロフィールへの移動を遮断
  // ==================================

  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");

    if (!link) return;

    const username = getUsername(
      link.getAttribute("href")
    );

    if (username && !isAllowed(username)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // ==================================
  // 動的画面更新
  // ==================================

  function schedule() {
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      filterArticles();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "xwl-get-current-username") return;
    sendResponse({ username: getCurrentUsername() });
  });

  // ==================================
  // ストレージ変更
  // ==================================

  chrome.storage.onChanged.addListener(
    (changes, area) => {
      if (
        area !== "local" ||
        !changes[KEY]
      ) return;

      allowed = new Set(
        (changes[KEY].newValue || [])
          .map(normalize)
          .filter(isValidUsername)
      );
      schedule();
    }
  );

  // ==================================
  // 初期化
  // ==================================

  async function init() {
    document.body.classList.add("xwl-loading");
    if (isImportPage) {
      document.body.classList.add("xwl-importing");
    }

    observer = new MutationObserver(schedule);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    try {
      await loadSettings();
      if (isImportPage) {
        await importFollowingAccounts();
      }
    } catch (error) {
      console.error("[XWL] Initialization failed", error);
      document.body.classList.remove("xwl-loading");
    }
  }

  init();

})();