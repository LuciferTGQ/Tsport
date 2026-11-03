import { test, expect, type Page, type Locator } from "@playwright/test";
import { dateKey, initialData, newExercise, samplePlan } from "../src/model";

test("体重两位小数可编辑、显示微小变化并经刷新和备份保留", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  await page.getByRole("button", { name: "记录体重", exact: true }).click();
  await page.getByLabel("体重日期").fill("2026-01-01");
  await page.getByLabel("体重公斤").fill("72.55");
  await page.getByRole("button", { name: "保存体重", exact: true }).click();
  await page.getByRole("button", { name: "记录体重", exact: true }).click();
  await page.getByLabel("体重日期").fill("2026-01-02");
  await page.getByLabel("体重公斤").fill("72.57");
  await page.getByRole("button", { name: "保存体重", exact: true }).click();
  await page.getByRole("button", { name: "编辑2026-01-02体重" }).click();
  await expect(page.getByLabel("体重公斤")).toHaveValue("72.57");
  await page.getByLabel("体重公斤").fill("72.56");
  await page.getByRole("button", { name: "保存体重", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.locator(".stat-value").nth(0)).toContainText("72.56");
  await expect(page.locator(".stat-value").nth(1)).toContainText("+0.01");
  await expect(page.locator(".weight-row strong")).toHaveText(["72.56 kg", "72.55 kg"]);
  await expect(page.getByRole("img", { name: /体重曲线/ })).toHaveAttribute("aria-label", /从72.55到72.56公斤/);
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部记录" }).click();
  const backup = await (await downloaded).path();
  await page.locator("input[type=file]").setInputFiles(backup!);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!).weights))
    .toEqual({ "2026-01-01": 72.55, "2026-01-02": 72.56 });
  await page.getByRole("button", { name: "训练日历", exact: true }).click();
  await page.getByLabel("选择年月").fill("2026-01");
  await page.getByRole("button", { name: "2026-01-02", exact: true }).click();
  await expect(page.locator(".weight-chip")).toContainText("72.56 kg");
});

test.describe("手机长按排序", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  async function seed(page: Page) {
    const data = initialData(), date = dateKey();
    data.days[date] = samplePlan(120);
    data.days[date].exercises[0].sets = 1;
    data.days[date].exercises.push(newExercise("哑铃飞鸟", 120), newExercise("器械推胸", 120));
    await page.addInitScript((data) => {
      if (!localStorage.getItem("tsport-v1")) localStorage.setItem("tsport-v1", JSON.stringify(data));
    }, data);
    await page.goto("/");
    return data.days[date].exercises;
  }

  async function align(page: Page, locator: Locator, top = 160) {
    await locator.evaluate((node, y) => window.scrollBy(0, node.getBoundingClientRect().top - y), top);
  }

  async function pickup(page: Page, locator: Locator) {
    const cdp = await page.context().newCDPSession(page);
    const box = (await locator.boundingBox())!;
    const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await expect(page.locator(".exercise-drag-preview")).toBeVisible();
    return { cdp, x, y };
  }

  async function drag(page: Page, from: Locator, to: Locator) {
    const { cdp, x, y } = await pickup(page, from);
    const target = (await to.boundingBox())!;
    const end = target.y + target.height / 2;
    for (let i = 1; i <= 12; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (end - y) * i / 12 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".exercise-drag-preview")).toHaveCount(0);
    await cdp.detach();
  }

  test("上移下移动作并保留训练计时、记录和刷新后的顺序", async ({ page }) => {
    const exercises = await seed(page);
    const cards = page.locator(".exercise-card");
    const card = (name: string) => cards.filter({ has: page.getByRole("button", { name, exact: true }) });
    const names = () => cards.locator(".exercise-name").allTextContents();
    await cards.first().getByRole("button", { name: "开始本组", exact: true }).tap();
    await page.getByRole("button", { name: "结束本组", exact: true }).tap();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
    // Long press the title itself; releasing after a drag must not open its editor.
    await align(page, card("上斜哑铃卧推"), 60);
    await drag(page, card("俯卧撑").locator(".exercise-name"), card("上斜哑铃卧推").locator(".exercise-name"));
    await expect.poll(names).toEqual(["杠铃卧推", "俯卧撑", "上斜哑铃卧推", "绳索夹胸", "哑铃飞鸟", "器械推胸"]);
    await expect(page.getByLabel("动作名称")).toHaveCount(0);
    const moved = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
    expect(moved.timer).toEqual(stored.timer);
    expect(moved.days[dateKey()].exercises[0].records).toEqual(stored.days[dateKey()].exercises[0].records);
    await align(page, card("俯卧撑"), 60);
    await drag(page, card("俯卧撑").locator(".exercise-info"), card("绳索夹胸").locator(".exercise-info"));
    await expect.poll(names).toEqual(exercises.map((e) => e.name));
    await align(page, card("上斜哑铃卧推"), 60);
    await drag(page, card("俯卧撑").locator(".exercise-name"), card("上斜哑铃卧推").locator(".exercise-name"));
    await page.reload();
    await expect.poll(names).toEqual(["杠铃卧推", "俯卧撑", "上斜哑铃卧推", "绳索夹胸", "哑铃飞鸟", "器械推胸"]);
    const dock = page.getByRole("region", { name: "训练计时器" });
    await dock.getByRole("button", { name: "完成该动作" }).tap();
    await expect(dock).toContainText("接下来：俯卧撑");
    await dock.getByRole("button", { name: "跳过休息" }).tap();
    await dock.getByRole("button", { name: "开始下一组" }).tap();
    await dock.getByRole("button", { name: "结束本组" }).tap();
    await expect(card("俯卧撑")).toContainText("1 组完成");
    await expect(card("杠铃卧推")).toContainText("1 组完成");
    await card("上斜哑铃卧推").locator(".exercise-name").tap();
    await expect(page.getByLabel("动作名称")).toHaveValue("上斜哑铃卧推");
  });

  test("普通滑动滚屏、长按拖动可自动滚屏，取消不保存", async ({ page }) => {
    const exercises = await seed(page);
    const first = page.locator(".exercise-card").first();
    await align(page, first, 220);
    const cdp = await page.context().newCDPSession(page);
    const scroll = await page.evaluate(() => scrollY);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 150, y: 295 }] });
    for (let y = 275; y >= 155; y -= 20) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 150, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll);
    await expect(page.locator(".exercise-drag-preview")).toHaveCount(0);
    await expect(page.locator(".exercise-name")).toHaveText(exercises.map((e) => e.name));
    await align(page, first, 140);
    const held = await pickup(page, first.locator(".exercise-name"));
    await held.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: held.x, y: 370 }] });
    await held.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(page.locator(".exercise-drag-preview")).toHaveCount(0);
    await expect(page.locator(".exercise-name")).toHaveText(exercises.map((e) => e.name));
    await held.cdp.detach();
    await align(page, first, 140);
    const dragging = await pickup(page, first.locator(".exercise-name"));
    const before = await page.evaluate(() => scrollY);
    await dragging.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: dragging.x, y: 765 }] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 250);
    await expect.poll(async () => (await page.locator(".exercise-card").last().boundingBox())!.y).toBeLessThan(740);
    await page.screenshot({ path: "artifacts/mobile-sort.png" });
    await dragging.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".exercise-name").last()).toHaveText("杠铃卧推");
    await dragging.cdp.detach();
    await cdp.detach();
  });
});

test("键盘排序可提交或取消，其他动作按钮正常工作", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "载入四动作示例" }).click();
  const handle = page.getByRole("button", { name: "调整杠铃卧推顺序" });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".exercise-drag-preview")).toBeVisible();
  // Keyboard coordinates become available after the newly mounted overlay is measured.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id^="DndLiveRegion-"]')).toContainText("移至第 2 位");
  await page.keyboard.press("Escape");
  await expect(page.locator(".exercise-drag-preview")).toHaveCount(0);
  await expect(page.locator(".exercise-name").first()).toHaveText("杠铃卧推");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".exercise-drag-preview")).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[id^="DndLiveRegion-"]')).toContainText("移至第 2 位");
  await page.keyboard.press("Space");
  await expect(page.locator(".exercise-name")).toHaveText(["上斜哑铃卧推", "杠铃卧推", "绳索夹胸", "俯卧撑"]);
  await page.getByRole("button", { name: "为杠铃卧推加一组", exact: true }).click();
  await expect(page.locator(".exercise-card").nth(1)).toContainText("1 组完成");
});

test("休息标签与绿色卡片连续切换动作，刷新后记录归属正确", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByRole("button", { name: "休息", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".tags-row")).toContainText("休息");
  await expect(page.locator(".stat-value").first()).toContainText("0");
  await page.reload();
  await expect(page.locator(".tags-row")).toContainText("休息");
  await page.getByRole("button", { name: "载入四动作示例" }).click();
  const card = page.locator(".exercise-card").first();
  await card.locator(".exercise-name").click();
  await page.getByLabel("目标组数").fill("1");
  await page.getByRole("button", { name: "保存动作" }).click();
  await expect(card.getByRole("button", { name: "完成该动作" })).toHaveCount(0);
  await card.getByRole("button", { name: "开始本组" }).click();
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  const dock = page.getByRole("region", { name: "训练计时器" });
  await expect(dock.getByRole("button", { name: "完成该动作" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mobile-complete.png", fullPage: true });
  await dock.getByRole("button", { name: "完成该动作" }).click();
  await expect(dock).toContainText("动作间休息");
  await expect(dock).toContainText("上斜哑铃卧推");
  await page.screenshot({ path: "artifacts/mobile-transition.png", fullPage: true });
  await expect(card).toContainText("动作已完成");
  await page.reload();
  await expect(dock).toContainText("动作间休息");
  await page.clock.fastForward(121000);
  await expect(dock).toContainText("准备好，再出发");
  await dock.getByRole("button", { name: "开始下一组" }).click();
  await expect(dock).toContainText("上斜哑铃卧推");
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  await expect(card).toContainText("1 组完成");
  await expect(page.locator(".exercise-card").nth(1)).toContainText("1 组完成");
  await expect(card).toContainText("动作已完成");
  await page.screenshot({ path: "artifacts/mobile-next-exercise.png", fullPage: true });
});

test('Android 桥接：提前安排系统提醒，修改截止时间，点击通知只返回训练',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.clock.install();
  await page.addInitScript(()=>{
    const win=window as any;
    win.androidBridge={};
    win.nativeTest={calls:[],listeners:{},exact:false};
    const promises=['checkPermissions','requestPermissions','checkExactNotificationSetting','changeExactNotificationSetting','createChannel','cancel','removeDeliveredNotificationsById','schedule','removeListener','status','openSettings'];
    win.Capacitor={PluginHeaders:['LocalNotifications','App','RestAlarm'].map(name=>({name,methods:[...promises.map(method=>({name:method,rtype:'promise'})),{name:'addListener',rtype:'callback'}]})),
      nativeCallback:(plugin:string,method:string,options:any,callback:any)=>{win.nativeTest.listeners[options.eventName]=callback;return Promise.resolve(options.eventName);},
      nativePromise:async(plugin:string,method:string,options:any)=>{
        win.nativeTest.calls.push({plugin,method,options,at:Date.now()});
        if(method==='checkPermissions'||method==='requestPermissions')return {display:'granted'};
        if(method==='changeExactNotificationSetting')win.nativeTest.exact=true;
        if(method==='checkExactNotificationSetting'||method==='changeExactNotificationSetting')return {exact_alarm:win.nativeTest.exact?'granted':'denied'};
        if(plugin==='RestAlarm'&&method==='schedule')return {status:win.nativeTest.exact?'scheduled':'foreground'};
        if(plugin==='RestAlarm'&&method==='status')return {version:'1.0.2',device:'Android 16',serviceRunning:true,activeTimers:1,display:true,exact:true,batteryUnrestricted:false,events:'foreground service started'};
        return {};
      },
    };
  });
  await page.goto('/');await page.getByRole('button',{name:'载入四动作示例'}).click();
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  await expect(page.getByText('准时提醒：未允许')).toBeVisible();
  await page.getByLabel('休息结束系统通知').click();
  await page.getByRole('button',{name:'开启准时提醒权限'}).click();
  await expect(page.getByText('准时提醒：已允许')).toBeVisible();
  await page.screenshot({path:'artifacts/android-notifications.png',fullPage:true});
  await page.getByRole('button',{name:'训练日历',exact:true}).click();
  await page.getByRole('button',{name:'开始本组',exact:true}).first().click();
  await page.getByRole('button',{name:'结束本组',exact:true}).click();
  await expect(page.getByText('通知栏倒计时已启动 · 系统闹钟已安排',{exact:true})).toBeVisible();
  const first=await page.evaluate(()=>{const calls=(window as any).nativeTest.calls;return calls.filter((c:any)=>c.method==='schedule').at(-1).options});
  expect(first.id).toBe(73101);
  expect(await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').at(-1).plugin)).toBe('RestAlarm');
  expect(first.deadline).toBeGreaterThan(await page.evaluate(()=>Date.now()));
  await page.getByRole('button',{name:'+30 秒',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>{const calls=(window as any).nativeTest.calls;return calls.filter((c:any)=>c.method==='schedule').length})).toBe(2);
  const deadline=await page.evaluate(()=>{const calls=(window as any).nativeTest.calls;return calls.filter((c:any)=>c.method==='schedule').at(-1).options.deadline});
  expect(deadline-first.deadline).toBe(30000);
  await page.getByRole('button',{name:'体重趋势',exact:true}).click();
  await page.clock.fastForward(151000);
  await page.evaluate(()=>{const t=(window as any).nativeTest;const n=t.calls.filter((c:any)=>c.method==='schedule').at(-1).options;t.listeners.alarmOpened({date:n.date,exerciseId:n.exerciseId});});
  await expect(page.locator('#day-detail')).toBeVisible();
  await expect(page.getByRole('region',{name:'训练计时器'})).toContainText('准备好，再出发');
  expect(await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').length)).toBe(2);
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'为杠铃卧推加一组'}).click();
  await page.getByRole('region',{name:'训练计时器'}).getByRole('button',{name:'完成该动作'}).click();
  await expect(page.getByRole('region',{name:'训练计时器'})).toContainText('动作间休息');
  await expect.poll(()=>page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').length)).toBe(3);
  const next=await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').at(-1).options);
  expect(next.exerciseId).not.toBe(first.exerciseId);
  expect(next.name).toBe('上斜哑铃卧推');
  await page.getByRole('button',{name:'关闭计时'}).click();
  await expect(page.getByRole('region',{name:'训练计时器'})).toHaveCount(0);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  await page.getByRole('button',{name:'30 秒后测试后台提醒'}).click();
  const alarm=await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').at(-1));
  expect(alarm.plugin).toBe('RestAlarm');expect(alarm.options.id).toBe(73102);
  expect(alarm.options.deadline-alarm.at).toBe(30000);
  // A test start dispatches directly to RestAlarm: no JS permission/channel awaits first.
  const calls=await page.evaluate(()=>(window as any).nativeTest.calls);
  const scheduleIndex=calls.findLastIndex((c:any)=>c.method==='schedule');
  expect(calls[scheduleIndex].plugin).toBe('RestAlarm');
  await expect(page.getByText('原生计时服务：正在运行',{exact:false})).toBeVisible();

});

test("系统提醒、后台到点、延长与跳过、通知回到原训练", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["notifications"]);
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "载入四动作示例" }).click();
  await page.locator(".exercise-name").first().click();
  await page.getByLabel("组间休息（秒）").fill("2");
  await page.getByRole("button", { name: "保存动作" }).click();
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.getByLabel("休息结束系统通知").click();
  await expect(
    page.getByRole("button", { name: "发送测试提醒" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "发送测试提醒" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return (await reg.getNotifications({ tag: "tsport-test" })).length;
      }),
    )
    .toBe(1);
  await page.getByRole("button", { name: "训练日历", exact: true }).click();
  await page
    .getByRole("button", { name: "开始本组", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  await page.getByRole("button", { name: "+30 秒", exact: true }).click();
  await page.clock.fastForward(3000);
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "组间休息",
  );
  await page.getByRole("button", { name: "跳过休息", exact: true }).click();
  await page.clock.fastForward(35000);
  expect(
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (await reg.getNotifications({ tag: "tsport-rest" })).length;
    }),
  ).toBe(0);
  await page
    .getByRole("region", { name: "训练计时器" })
    .getByRole("button", { name: "开始下一组" })
    .click();
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  const other = await context.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.clock.fastForward(2500);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        const notices = await reg.getNotifications({ tag: "tsport-rest" });
        return notices.map((n) => ({ title: n.title, data: n.data }));
      }),
    )
    .toMatchObject([
      { title: "休息结束 · Tsport", data: { exerciseId: expect.any(String) } },
    ]);
  await other.close();
  await page.bringToFront();
  await expect(page.locator(".rest-alert")).toBeVisible();
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  // Exercise the app side of the service-worker click bridge. Worker focus/open is tested separately.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const [notice] = await reg.getNotifications({ tag: "tsport-rest" });
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "TSPORT_OPEN_TRAINING", target: notice.data },
      }),
    );
  });
  await expect(page.locator("#day-detail")).toBeVisible();
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "准备好，再出发",
  );
  await page
    .getByRole("region", { name: "训练计时器" })
    .getByRole("button", { name: "开始下一组" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return (await reg.getNotifications({ tag: "tsport-rest" })).length;
      }),
    )
    .toBe(0);
});

test("通知被拒绝时保留页面提醒，不自动反复请求权限", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Notification.requestPermission = () => {
      throw Error("must not prompt again");
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await expect(
    page.getByText("通知已被浏览器阻止。", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("休息结束系统通知").click();
  await expect(page.getByLabel("休息结束系统通知")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "发送测试提醒" }),
  ).toBeDisabled();
});

test("完整训练流程、刷新恢复、修改记录、体重、标签、模板与备份", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "载入四动作示例" }).click();
  await expect(page.locator(".exercise-card")).toHaveCount(4);
  await page.getByRole("button", { name: "标签", exact: true }).click();
  await page.getByPlaceholder("例如：核心、有氧、全身").fill("核心");
  await page.getByRole("button", { name: "创建并添加标签" }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.locator(".tags-row")).toContainText("核心");
  await page.locator(".exercise-name").first().click();
  await page.getByLabel("目标组数").fill("4");
  await page.getByLabel("每组次数").fill("8");
  await page.getByLabel("组间休息（秒）").fill("2");
  await page.getByRole("button", { name: "保存动作" }).click();
  await expect(page.locator(".exercise-info").first()).toContainText("4 × 8");
  await page
    .getByRole("button", { name: "开始本组", exact: true })
    .first()
    .click();
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "本组训练中",
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "本组训练中",
  );
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  await expect(page.locator(".calendar-day.selected")).toHaveClass(/worked/);
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "组间休息",
  );
  await expect(page.getByRole("region", { name: "训练计时器" })).toContainText(
    "准备好，再出发",
    { timeout: 5000 },
  );
  await expect(page.locator(".exercise-card").first()).toContainText(
    "1 组完成",
  );
  await page.getByRole("button", { name: "关闭计时", exact: true }).click();
  await page
    .getByRole("button", { name: "为杠铃卧推加一组", exact: true })
    .click();
  await expect(page.locator(".exercise-card").first()).toContainText(
    "2 组完成",
  );
  await page
    .getByRole("button", { name: "杠铃卧推第2组记录", exact: true })
    .click();
  await page.getByLabel("实际次数").fill("7");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page
    .getByRole("button", { name: "杠铃卧推第2组记录", exact: true })
    .click();
  await expect(page.getByLabel("实际次数")).toHaveValue("7");
  await page.getByRole("button", { name: "撤销本组记录" }).click();
  await expect(page.locator(".exercise-card").first()).toContainText(
    "1 组完成",
  );
  await page.getByRole("button", { name: "保存为训练模板" }).click();
  await page.getByLabel("模板名称").fill("我的胸部日");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  await page.getByRole("button", { name: "记录体重", exact: true }).click();
  await page.getByRole("spinbutton", { name: "体重公斤" }).fill("72.5");
  await page.getByRole("button", { name: "保存体重", exact: true }).click();
  await expect(page.getByRole("img", { name: /体重曲线/ })).toBeVisible();
  await expect(page.locator(".weight-row")).toContainText("72.5");
  await page.reload();
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  await expect(page.locator(".weight-row")).toContainText("72.5");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部记录" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/tsport-.*\.json/);
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1}'),
  });
  await expect(page.locator(".toast")).toContainText("备份格式无效");
  await page.locator("input[type=file]").setInputFiles(backupPath!);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "体重趋势", exact: true }).click();
  await expect(page.locator(".weight-row")).toContainText("72.5");
  await page.getByRole("button", { name: "记录体重", exact: true }).click();
  await page.getByLabel("体重日期").fill("2026-01-01");
  await page.getByLabel("体重公斤").fill("74");
  await page.getByRole("button", { name: "保存体重", exact: true }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByRole("img", { name: /体重曲线/ })).toHaveAttribute(
    "aria-label",
    /共2笔记录/,
  );
  await page.screenshot({ path: "artifacts/weight.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("手机布局无横向溢出，跨年日期和空白真实数据", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".stat-value").first()).toContainText("0");
  await page.getByRole("button", { name: "载入四动作示例" }).click();
  await page.getByLabel("选择年月").fill("2026-12");
  await page.getByRole("button", { name: "下个月", exact: true }).click();
  await expect(page.getByLabel("选择年月")).toHaveValue("2027-01");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "回到今天" }).click();
  await expect(page.locator(".toast")).toBeHidden({ timeout: 5000 });
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await page
    .getByRole("button", { name: "开始本组", exact: true })
    .first()
    .click();
  await expect(page.getByRole("region", { name: "训练计时器" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "artifacts/mobile-timer.png", fullPage: true });
});

test("生产离线缓存可重新打开", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "把进步，记下来。" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("复制新旧模板均不带训练随记，保留来源记录与目标日期随记", async ({ page }) => {
  const data = initialData(), source = dateKey();
  const previous = new Date();
  previous.setDate(previous.getDate() - 1);
  const destination = dateKey(previous);
  previous.setDate(previous.getDate() - 1);
  const emptyDate = dateKey(previous);
  data.days[source] = samplePlan(120);
  data.days[source].note = "只属于来源日期的训练感受";
  data.days[source].exercises[0].targetWeights = [20, 25, 30, 35];
  data.days[source].exercises[0].records = [{ id: "historical-set", reps: 10, kg: 18, duration: 45, at: 1000 }];
  data.days[destination] = { tags: [], exercises: [], note: "目标日期已经写好的随记" };
  data.templates.push({ id: "legacy-note", name: "旧版含随记模板", day: structuredClone(data.days[source]) });
  await page.addInitScript((data) => localStorage.setItem("tsport-v1", JSON.stringify(data)), data);
  await page.goto("/");
  await page.getByRole("button", { name: "保存为训练模板", exact: true }).click();
  await page.getByLabel("模板名称").fill("新版不含随记模板");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  expect(saved.templates[1].day.note).toBe("");
  expect(saved.templates[1].day.exercises[0].records).toEqual([]);
  expect(saved.templates[1].day.exercises[0].targetWeights).toEqual([20, 25, 30, 35]);
  expect(saved.days[source]).toEqual(data.days[source]);
  await page.getByLabel("选择年月").fill(destination.slice(0, 7));
  await page.getByRole("button", { name: destination, exact: true }).click();
  await page.getByRole("button", { name: "训练模板", exact: true }).click();
  await page.getByRole("button", { name: /新版不含随记模板.*只复制计划/ }).click();
  await expect(page.getByPlaceholder("今天的状态、动作感受……")).toHaveValue("目标日期已经写好的随记");
  await expect(page.locator(".exercise-card").first()).toContainText("0 组完成");
  await page.getByLabel("选择年月").fill(emptyDate.slice(0, 7));
  await page.getByRole("button", { name: emptyDate, exact: true }).click();
  await page.getByRole("button", { name: "训练模板", exact: true }).click();
  await page.getByRole("button", { name: /旧版含随记模板.*只复制计划/ }).click();
  await expect(page.getByPlaceholder("今天的状态、动作感受……")).toHaveValue("");
  const loaded = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  expect(loaded.days[source]).toEqual(data.days[source]);
  expect(loaded.days[emptyDate].exercises[0].records).toEqual([]);
  expect(loaded.days[emptyDate].exercises[0].targetWeights).toEqual([20, 25, 30, 35]);
  expect(loaded.days[emptyDate].exercises[0].id).not.toBe(data.days[source].exercises[0].id);
});

test("递增组目标经计时和补记自动记录，目标修改保留历史，组数缩放保留输入", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "添加训练动作", exact: true }).click();
  await page.getByRole("button", { name: "新建动作", exact: true }).click();
  await page.getByLabel("动作名称", { exact: true }).fill("递增卧推");
  await page.getByLabel("目标组数", { exact: true }).fill("3");
  await page.getByLabel("每组次数", { exact: true }).fill("10");
  await page.getByLabel("目标重量（kg）", { exact: true }).fill("20");
  await page.getByLabel("组间休息（秒）", { exact: true }).fill("0");
  await page.getByLabel("每组单独设置重量", { exact: true }).check();
  await page.getByLabel("目标重量（kg）", { exact: true }).fill("15");
  await expect(page.getByLabel("第 1 组目标重量（kg）", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "应用到全部组", exact: true }).click();
  await expect(page.getByLabel("第 3 组目标重量（kg）", { exact: true })).toHaveValue("15");
  await page.getByLabel("目标重量（kg）", { exact: true }).fill("20");
  await page.getByRole("button", { name: "应用到全部组", exact: true }).click();
  await page.getByLabel("第 2 组目标重量（kg）", { exact: true }).fill("25");
  await page.getByLabel("第 3 组目标重量（kg）", { exact: true }).fill("30");
  await page.getByLabel("目标组数", { exact: true }).fill("2");
  await expect(page.getByLabel("第 3 组目标重量（kg）", { exact: true })).toHaveCount(0);
  await page.getByLabel("目标组数", { exact: true }).fill("4");
  await expect(page.getByLabel("第 3 组目标重量（kg）", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("第 4 组目标重量（kg）", { exact: true })).toHaveValue("20");
  await page.getByLabel("目标组数", { exact: true }).fill("3");
  await page.getByLabel("同时保存到动作库", { exact: true }).check();
  await page.getByLabel("动作分类", { exact: true }).selectOption("胸");
  expect(await page.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mobile-set-targets.png" });
  await page.getByRole("button", { name: "保存动作", exact: true }).click();
  await expect(page.getByLabel("递增卧推每组目标重量", { exact: true })).toContainText("第 3 组 30 kg");
  await page.getByRole("button", { name: "为递增卧推加一组", exact: true }).click();
  await page.locator(".exercise-card").getByRole("button", { name: "开始下一组", exact: true }).click();
  const dock = page.getByRole("region", { name: "训练计时器" });
  await expect(dock).toContainText("第 2 组目标 · 10 次 × 25 kg");
  await dock.getByRole("button", { name: "结束本组", exact: true }).click();
  await page.locator(".exercise-name").click();
  await page.getByLabel("第 1 组目标重量（kg）", { exact: true }).fill("22");
  await page.getByLabel("第 3 组目标重量（kg）", { exact: true }).fill("35");
  await page.getByRole("button", { name: "保存动作", exact: true }).click();
  await expect(dock).toContainText("第 3 组目标 · 10 次 × 35 kg");
  await page.reload();
  await expect(dock).toContainText("第 3 组目标 · 10 次 × 35 kg");
  await dock.getByRole("button", { name: "开始下一组", exact: true }).click();
  await dock.getByRole("button", { name: "结束本组", exact: true }).click();
  await dock.getByRole("button", { name: "再加练一组", exact: true }).click();
  await expect(dock).toContainText("第 4 组目标 · 10 次 × 35 kg");
  await dock.getByRole("button", { name: "结束本组", exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  const exercise = stored.days[dateKey()].exercises[0];
  expect(exercise.records.map((record: { kg: number }) => record.kg)).toEqual([20, 25, 35, 35]);
  expect(exercise.records.map((record: { reps: number }) => record.reps)).toEqual([10, 10, 10, 10]);
  expect(exercise.records[0].duration).toBeNull();
  expect(exercise.records[1].duration).not.toBeNull();
  expect(stored.exerciseLibrary[0].category).toBe("胸");
  expect(stored.exerciseLibrary[0].exercise.targetWeights).toEqual([20, 25, 30]);
  expect(stored.exerciseLibrary[0].exercise.records).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("动作库按分类搜索并独立编辑添加删除，刷新和备份恢复完整配置", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const data = initialData(), today = dateKey();
  const exercise = newExercise("高位下拉", 90);
  exercise.sets = 2;
  exercise.targetWeights = [10, 15];
  exercise.records = [{ id: "original-record", reps: 12, kg: 10, duration: 40, at: 1000 }];
  data.days[today] = { tags: ["back"], exercises: [exercise], note: "当天随记" };
  data.exerciseLibrary = [{ id: "chest-preset", category: "胸", exercise: newExercise("哑铃卧推", 120) }];
  await page.addInitScript((data) => {
    if (!localStorage.getItem("tsport-v1")) localStorage.setItem("tsport-v1", JSON.stringify(data));
  }, data);
  await page.goto("/");
  await page.locator(".exercise-card").getByRole("button", { name: "存入动作库", exact: true }).click();
  await expect(page.getByLabel("动作分类", { exact: true })).toHaveValue("背");
  await page.getByRole("button", { name: "保存到动作库", exact: true }).click();
  const filters = page.getByRole("group", { name: "动作分类筛选" });
  await filters.getByRole("button", { name: "背", exact: true }).click();
  await expect(page.getByRole("article", { name: "已保存动作：高位下拉", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "已保存动作：哑铃卧推", exact: true })).toHaveCount(0);
  await page.getByLabel("搜索已保存动作").fill("卧推");
  await expect(page.getByText("没有找到动作", { exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByRole("article", { name: "已保存动作：哑铃卧推", exact: true })).toBeVisible();
  await page.getByLabel("搜索已保存动作").fill("下拉");
  await page.getByRole("button", { name: "编辑已保存动作高位下拉", exact: true }).click();
  await page.getByLabel("动作名称", { exact: true }).fill("下拉轻量组");
  await page.getByLabel("每组次数", { exact: true }).fill("8");
  await page.getByLabel("第 2 组目标重量（kg）", { exact: true }).fill("17.5");
  await page.getByLabel("动作分类", { exact: true }).selectOption("其他");
  await page.getByRole("button", { name: "保存到动作库", exact: true }).click();
  await filters.getByRole("button", { name: "其他", exact: true }).click();
  const preset = page.getByRole("article", { name: "已保存动作：下拉轻量组", exact: true });
  await expect(preset).toContainText("2 组 × 8 次");
  await expect(preset).toContainText("10 / 17.5 kg");
  expect(await page.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mobile-exercise-library.png" });
  await page.getByRole("button", { name: "添加下拉轻量组到当天", exact: true }).click();
  await expect(page.locator(".exercise-card")).toHaveCount(2);
  await page.reload();
  const updated = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  expect(updated.days[today].exercises[0]).toEqual(exercise);
  const added = updated.days[today].exercises[1];
  expect(added.name).toBe("下拉轻量组");
  expect(added.reps).toBe(8);
  expect(added.targetWeights).toEqual([10, 17.5]);
  expect(added.records).toEqual([]);
  expect(added.id).not.toBe(exercise.id);
  expect(added.id).not.toBe(updated.exerciseLibrary[1].exercise.id);
  expect(updated.exerciseLibrary[1].exercise.records).toEqual([]);
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部记录", exact: true }).click();
  const backupPath = await (await download).path();
  await page.getByRole("button", { name: "训练日历", exact: true }).click();
  await page.getByRole("button", { name: "添加训练动作", exact: true }).click();
  await page.getByRole("button", { name: "删除已保存动作下拉轻量组", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  const removed = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  expect(removed.exerciseLibrary).toHaveLength(1);
  expect(removed.days[today]).toEqual(updated.days[today]);
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(backupPath!);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  expect(restored.exerciseLibrary).toEqual(updated.exerciseLibrary);
  expect(restored.days[today]).toEqual(updated.days[today]);
});


test("逐组休息编辑、缩放、刷新与计时，保留正在进行的休息", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "添加训练动作", exact: true }).click();
  await page.getByRole("button", { name: "新建动作", exact: true }).click();
  await page.getByLabel("动作名称", { exact: true }).fill("逐组休息卧推");
  await page.getByLabel("目标组数", { exact: true }).fill("3");
  await page.getByLabel("每组单独设置休息", { exact: true }).check();
  await page.getByLabel("第 2 组后休息（秒）", { exact: true }).fill("150");
  await page.getByLabel("第 3 组后休息（秒）", { exact: true }).fill("180");
  await page.getByLabel("目标组数", { exact: true }).fill("2");
  await page.getByLabel("目标组数", { exact: true }).fill("4");
  await expect(page.getByLabel("第 3 组后休息（秒）", { exact: true })).toHaveValue("180");
  await expect(page.getByLabel("第 4 组后休息（秒）", { exact: true })).toHaveValue("120");
  await page.getByLabel("目标组数", { exact: true }).fill("3");
  await page.getByLabel("同时保存到动作库", { exact: true }).check();
  expect(await page.locator("dialog").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/mobile-set-rests.png" });
  await page.getByRole("button", { name: "保存动作", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("逐组休息卧推每组休息时间")).toContainText("第 3 组后 03:00");
  await page.locator(".exercise-card").getByRole("button", { name: "开始本组", exact: true }).click();
  const dock = page.getByRole("region", { name: "训练计时器" });
  await dock.getByRole("button", { name: "结束本组", exact: true }).click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("tsport-v1")!));
  const first = await stored();
  expect(first.timer.deadline - first.timer.started).toBe(120000);
  expect(first.exerciseLibrary[0].exercise.setRests).toEqual([120, 150, 180]);
  await page.locator(".exercise-name").click();
  await page.getByLabel("第 1 组后休息（秒）", { exact: true }).fill("60");
  await page.getByRole("button", { name: "保存动作", exact: true }).click();
  expect((await stored()).timer.deadline).toBe(first.timer.deadline);
  expect((await stored()).days[dateKey()].exercises[0].records).toEqual(first.days[dateKey()].exercises[0].records);
  await dock.getByRole("button", { name: "跳过休息", exact: true }).click();
  await dock.getByRole("button", { name: "开始下一组", exact: true }).click();
  await dock.getByRole("button", { name: "结束本组", exact: true }).click();
  const second = await stored();
  expect(second.timer.deadline - second.timer.started).toBe(150000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
