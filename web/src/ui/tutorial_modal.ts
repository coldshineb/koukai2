// modern/tutorial_modal.ts — 独立游戏内「航海教程」页面（完整收录《大航海时代外传》42 篇建筑老人/醉汉/船爱好者教程 + 60 条航海小贴士）
import { createDomModal } from "./dom_ui.ts";

interface TutorialSegment {
  t: string;
  hi: boolean;
}

interface TutorialEntry {
  title: string;
  segments: TutorialSegment[];
}

interface TutorialCategory {
  id: string;
  name: string;
  npc: string;
  greeting: string;
  entries: TutorialEntry[];
}

interface TutorialData {
  source: string;
  categories: TutorialCategory[];
  tips: string[];
}

const TAB_SHORT: Record<string, string> = {
  market: "交易所",
  tavern: "酒馆",
  shipyard: "造船厂",
  wharf: "码头",
};

let cachedData: TutorialData | null = null;
let openHandle: { close: () => void } | null = null;

async function loadTutorialData(): Promise<TutorialData> {
  if (cachedData) return cachedData;
  const res = await fetch("./assets/data/tutorial.json");
  if (!res.ok) throw new Error(`加载航海教程失败 (${res.status})`);
  cachedData = (await res.json()) as TutorialData;
  return cachedData;
}

export async function openTutorialModal(): Promise<void> {
  if (openHandle) return;
  let data: TutorialData;
  try {
    data = await loadTutorialData();
  } catch (e) {
    console.error(e);
    return;
  }

  let activeTab = 0; // 0..3 = categories, 4 = 航海小贴士
  const selectedEntry = data.categories.map(() => 0);
  let tipFilter = "";

  const modal = createDomModal({
    title: "航海教程",
    size: "wide",
    cancelable: true,
    closeLabel: "关闭",
    onCancel: () => {
      openHandle = null;
    },
  });
  openHandle = modal;

  // 顶部标签栏
  const tabBar = document.createElement("div");
  tabBar.className = "uw2-tabs";
  tabBar.style.marginBottom = "12px";

  const content = document.createElement("div");
  content.className = "uw2-tut-content";

  modal.body.append(tabBar, content);

  const render = (preserveScroll = false) => {
    const prevListScroll = preserveScroll
      ? (content.querySelector<HTMLElement>(".uw2-tut-list")?.scrollTop ?? 0)
      : 0;

    tabBar.innerHTML = "";
    data.categories.forEach((cat, idx) => {
      const btn = document.createElement("button");
      btn.className = `uw2-tab-btn${activeTab === idx ? " active" : ""}`;
      btn.textContent = `${TAB_SHORT[cat.id] ?? cat.name} (${cat.entries.length})`;
      btn.addEventListener("click", () => {
        activeTab = idx;
        render(false);
      });
      tabBar.appendChild(btn);
    });
    const tipsBtn = document.createElement("button");
    tipsBtn.className = `uw2-tab-btn${activeTab === data.categories.length ? " active" : ""}`;
    tipsBtn.textContent = `航海小贴士 (${data.tips.length})`;
    tipsBtn.addEventListener("click", () => {
      activeTab = data.categories.length;
      render(false);
    });
    tabBar.appendChild(tipsBtn);

    content.innerHTML = "";

    if (activeTab < data.categories.length) {
      const cat = data.categories[activeTab];
      const curIdx = selectedEntry[activeTab] ?? 0;
      const entry = cat.entries[curIdx] ?? cat.entries[0];

      const split = document.createElement("div");
      split.className = "uw2-tut-split";

      // 左侧目录
      const left = document.createElement("div");
      left.className = "uw2-tut-list";
      cat.entries.forEach((it, idx) => {
        const itemBtn = document.createElement("button");
        itemBtn.className = `uw2-tut-item${idx === curIdx ? " active" : ""}`;
        itemBtn.textContent = `${idx + 1}. ${it.title}`;
        itemBtn.addEventListener("click", () => {
          selectedEntry[activeTab] = idx;
          render(true);
        });
        left.appendChild(itemBtn);
      });

      // 右侧正文
      const right = document.createElement("div");
      right.className = "uw2-tut-reader";

      const greet = document.createElement("div");
      greet.className = "uw2-tut-greet";
      greet.innerHTML = `<span class="uw2-tut-npc">${cat.npc}</span><span>「${cat.greeting}」</span>`;

      const heading = document.createElement("h3");
      heading.className = "uw2-tut-title";
      heading.textContent = entry.title;

      const body = document.createElement("p");
      body.className = "uw2-tut-body";
      for (const seg of entry.segments) {
        if (seg.hi) {
          const em = document.createElement("strong");
          em.className = "uw2-tut-hi";
          em.textContent = seg.t;
          body.appendChild(em);
        } else {
          body.appendChild(document.createTextNode(seg.t));
        }
      }

      const nav = document.createElement("div");
      nav.className = "uw2-tut-nav";
      const prevBtn = document.createElement("button");
      prevBtn.className = "uw2-btn";
      prevBtn.textContent = "← 上一篇";
      prevBtn.disabled = curIdx <= 0;
      prevBtn.addEventListener("click", () => {
        if (curIdx > 0) {
          selectedEntry[activeTab] = curIdx - 1;
          render(true);
        }
      });

      const counter = document.createElement("span");
      counter.className = "uw2-tut-counter";
      counter.textContent = `${curIdx + 1} / ${cat.entries.length}`;

      const nextBtn = document.createElement("button");
      nextBtn.className = "uw2-btn";
      nextBtn.textContent = "下一篇 →";
      nextBtn.disabled = curIdx >= cat.entries.length - 1;
      nextBtn.addEventListener("click", () => {
        if (curIdx < cat.entries.length - 1) {
          selectedEntry[activeTab] = curIdx + 1;
          render(true);
        }
      });

      nav.append(prevBtn, counter, nextBtn);
      right.append(greet, heading, body, nav);
      split.append(left, right);
      content.appendChild(split);
      if (preserveScroll) left.scrollTop = prevListScroll;
    } else {
      // 航海小贴士（60 条 + 搜索过滤）
      const searchRow = document.createElement("div");
      searchRow.className = "uw2-tut-search-row";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "uw2-input uw2-tut-search";
      inp.placeholder = "输入关键词筛选（如：两点间贸易、单挑、水手比例、炮术、学者……）";
      inp.value = tipFilter;
      inp.addEventListener("input", () => {
        tipFilter = inp.value;
        renderTipsList(listBox);
      });
      searchRow.appendChild(inp);

      const listBox = document.createElement("div");
      listBox.className = "uw2-tut-tips-list";

      const renderTipsList = (box: HTMLElement) => {
        box.innerHTML = "";
        const kw = tipFilter.trim().toLowerCase();
        const filtered = data.tips
          .map((t, i) => ({ idx: i + 1, text: t }))
          .filter(x => !kw || x.text.toLowerCase().includes(kw));
        if (!filtered.length) {
          const empty = document.createElement("div");
          empty.className = "uw2-tut-empty";
          empty.textContent = "没有匹配的小贴士。";
          box.appendChild(empty);
          return;
        }
        for (const item of filtered) {
          const row = document.createElement("div");
          row.className = "uw2-tut-tip-row";
          row.innerHTML = `<span class="uw2-tut-tip-num">${item.idx}</span><span>${item.text}</span>`;
          box.appendChild(row);
        }
      };

      renderTipsList(listBox);
      content.append(searchRow, listBox);
    }
  };

  render();
}
