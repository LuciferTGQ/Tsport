import { test, expect } from "@playwright/test";

test("休息日标签与达标完成动作，刷新保留状态并可加练", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
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
  await expect(dock).toHaveCount(0);
  await expect(card).toContainText("动作已完成");
  await page.reload();
  await expect(card).toContainText("动作已完成");
  await card.getByRole("button", { name: "再加练一组" }).click();
  await expect(dock).toContainText("本组训练中");
  await expect(card).not.toContainText("动作已完成");
  await page.getByRole("button", { name: "结束本组", exact: true }).click();
  await dock.getByRole("button", { name: "完成该动作" }).click();
  await expect(card).toContainText("2 组完成");
});

test('Android 桥接：提前安排系统提醒，修改截止时间，点击通知只返回训练',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.clock.install();
  await page.addInitScript(()=>{
    const win=window as any;
    win.androidBridge={};
    win.nativeTest={calls:[],listeners:{},exact:false};
    const promises=['checkPermissions','requestPermissions','checkExactNotificationSetting','changeExactNotificationSetting','createChannel','cancel','removeDeliveredNotificationsById','schedule','removeListener'];
    win.Capacitor={PluginHeaders:['LocalNotifications','App','RestAlarm'].map(name=>({name,methods:[...promises.map(method=>({name:method,rtype:'promise'})),{name:'addListener',rtype:'callback'}]})),
      nativeCallback:(plugin:string,method:string,options:any,callback:any)=>{win.nativeTest.listeners[options.eventName]=callback;return Promise.resolve(options.eventName);},
      nativePromise:async(plugin:string,method:string,options:any)=>{
        win.nativeTest.calls.push({plugin,method,options,at:Date.now()});
        if(method==='checkPermissions'||method==='requestPermissions')return {display:'granted'};
        if(method==='changeExactNotificationSetting')win.nativeTest.exact=true;
        if(method==='checkExactNotificationSetting'||method==='changeExactNotificationSetting')return {exact_alarm:win.nativeTest.exact?'granted':'denied'};
        return {};
      },
    };
  });
  await page.goto('/');await page.getByRole('button',{name:'载入四动作示例'}).click();
  await page.locator('.exercise-name').first().click();
  await page.getByLabel('目标组数').fill('1');
  await page.getByRole('button',{name:'保存动作'}).click();
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  await expect(page.getByText('准时提醒：未允许')).toBeVisible();
  await page.getByLabel('休息结束系统通知').click();
  await page.getByRole('button',{name:'开启准时提醒权限'}).click();
  await expect(page.getByText('准时提醒：已允许')).toBeVisible();
  await page.screenshot({path:'artifacts/android-notifications.png',fullPage:true});
  await page.getByRole('button',{name:'训练日历',exact:true}).click();
  await page.getByRole('button',{name:'开始本组',exact:true}).first().click();
  await page.getByRole('button',{name:'结束本组',exact:true}).click();
  await expect(page.getByText('Android 系统提醒已安排',{exact:true})).toBeVisible();
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
  const cancellations=await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.plugin==='RestAlarm'&&c.method==='cancel').length);
  await page.getByRole('region',{name:'训练计时器'}).getByRole('button',{name:'完成该动作'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.plugin==='RestAlarm'&&c.method==='cancel').length)).toBeGreaterThan(cancellations);
  await expect(page.getByRole('region',{name:'训练计时器'})).toHaveCount(0);
  await page.getByRole('button',{name:'偏好设置',exact:true}).click();
  await page.getByRole('button',{name:'30 秒后测试后台提醒'}).click();
  const alarm=await page.evaluate(()=>(window as any).nativeTest.calls.filter((c:any)=>c.method==='schedule').at(-1));
  expect(alarm.plugin).toBe('RestAlarm');expect(alarm.options.id).toBe(73102);
  expect(alarm.options.deadline-alarm.at).toBe(30000);

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
