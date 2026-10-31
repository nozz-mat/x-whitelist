"use strict";

const KEY = "xwl_allowed_users";

const usernameInput =
  document.getElementById("username");

const addButton =
  document.getElementById("add");

const importFollowingButton =
  document.getElementById("import-following");

const accountList =
  document.getElementById("account-list");

const count =
  document.getElementById("count");

const status =
  document.getElementById("status");

const confirmBox =
  document.getElementById("follow-confirm");

const confirmMessage =
  document.getElementById("confirm-message");

const openProfileButton =
  document.getElementById("open-profile");

const cancelFollowButton =
  document.getElementById("cancel-follow");

let pendingUsername = null;

const normalize = value =>
  String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

const valid = name =>
  /^[a-z0-9_]{1,15}$/.test(name);

// ----------------------------------
// ストレージ
// ----------------------------------

async function getAccounts() {
  const result = await chrome.storage.local.get({
    [KEY]: []
  });

  return [...new Set(
    result[KEY].map(normalize).filter(valid)
  )];
}

async function saveAccounts(accounts) {
  await chrome.storage.local.set({
    [KEY]: [...new Set(accounts)]
  });

  render();
}

// ----------------------------------
// ステータス
// ----------------------------------

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

// ----------------------------------
// 一覧表示
// ----------------------------------

async function render() {
  const accounts = await getAccounts();

  accountList.replaceChildren();

  count.textContent = `${accounts.length}件`;

  for (const username of accounts) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = `@${username}`;

    const remove = document.createElement("button");
    remove.textContent = "削除";
    remove.className = "remove";

    remove.addEventListener("click", async () => {
      const updated = await getAccounts();

      await saveAccounts(
        updated.filter(item => item !== username)
      );

      showStatus(`@${username} を削除しました。`);
    });

    li.append(name, remove);
    accountList.appendChild(li);
  }
}

// ----------------------------------
// アカウント追加
// ----------------------------------

async function addAccount() {
  const username = normalize(usernameInput.value);

  if (!valid(username)) {
    showStatus(
      "ユーザー名を正しく入力してください。",
      true
    );
    return;
  }

  const accounts = await getAccounts();

  if (accounts.includes(username)) {
    showStatus("登録済みのアカウントです。", true);
    return;
  }

  accounts.push(username);

  await saveAccounts(accounts);

  usernameInput.value = "";

  pendingUsername = username;

  confirmMessage.textContent =
    `@${username} を登録しました。このアカウントをフォローしますか？`;

  confirmBox.classList.remove("hidden");

  showStatus(`@${username} を許可リストに追加しました。`);
}

// ----------------------------------
// プロフィールを開く
// ----------------------------------

openProfileButton.addEventListener("click", async () => {
  if (!pendingUsername) return;

  const username = pendingUsername;

  await chrome.tabs.create({
    url: `https://x.com/${encodeURIComponent(username)}`
  });

  pendingUsername = null;
  confirmBox.classList.add("hidden");

  showStatus(
    "プロフィールを開きました。X上でフォローしてください。"
  );
});

// ----------------------------------
// フォローしない
// ----------------------------------

cancelFollowButton.addEventListener("click", () => {
  pendingUsername = null;
  confirmBox.classList.add("hidden");
});

// ----------------------------------
// フォロー中アカウントの一括登録
// ----------------------------------

importFollowingButton.addEventListener("click", async () => {
  importFollowingButton.disabled = true;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!activeTab?.id) {
      showStatus("現在のタブを取得できませんでした。", true);
      return;
    }

    if (!/^https:\/\/(www\.)?x\.com\//i.test(activeTab.url || "")) {
      showStatus("Xのページを開いてから実行してください。", true);
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "xwl-get-current-username"
      });
    } catch (error) {
      console.error("[XWL] Could not reach content script", error);
      showStatus("拡張機能を再読み込みし、Xのページも更新してからお試しください。", true);
      return;
    }

    const username = normalize(response?.username);

    if (!valid(username)) {
      showStatus("Xのプロフィール情報を取得できませんでした。ページを更新して再度お試しください。", true);
      return;
    }

    await chrome.tabs.create({
      url: `https://x.com/${encodeURIComponent(username)}/following?xwl_import=1`
    });
  } catch (error) {
    console.error("[XWL] Could not open following list", error);
    showStatus("フォロー中一覧を開けませんでした。詳細は拡張機能のエラーを確認してください。", true);
  } finally {
    importFollowingButton.disabled = false;
  }
});

// ----------------------------------
// イベント
// ----------------------------------

addButton.addEventListener("click", addAccount);

usernameInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    addAccount();
  }
});

// ----------------------------------
// 初期化
// ----------------------------------

render();