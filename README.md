# Tsport · 私人训练日记

以 **Android 手机应用**为主要交付，使用 React + TypeScript 界面和 Capacitor 原生工程。训练、日历、体重等离线可用；休息通过 Android 前台服务计时，并在通知栏显示常驻倒计时；系统闹钟作为到点唤醒的另一条路径。网页保留为开发预览。产品设计见 [DESIGN.md](./DESIGN.md)。

正式仓库：[LuciferTGQ/Tsport](https://github.com/LuciferTGQ/Tsport)。后续项目更新会在验证后同步提交、推送，约定见 [AGENTS.md](./AGENTS.md)。

## Android 安装与提醒

安装包：[Tsport-1.0.2-debug.apk](./releases/Tsport-1.0.2-debug.apk)（自用测试版，Android 8.0 及以上，约 4.3 MB）。将 APK 复制到手机打开，按手机提示允许该文件来源安装。另见[安装说明](./releases/安装说明.md)和 [SHA-256 校验文件](./releases/Tsport-1.0.2-debug.apk.sha256)。

首次进入「偏好设置」：

1. 开启「休息结束系统通知」，允许通知权限。
2. 点击「开启准时提醒权限」，在 Android 的「闹钟与提醒」页面允许 Tsport。
3. 开启所需的声音、震动，点击「30 秒后测试后台提醒」后立即切到其他应用，等待提醒。若没有横幅，在手机的 Tsport 通知设置中开启横幅/弹出通知。
4. 结束一组后，下拉通知栏应立即看到常驻倒计时，可切去其他应用。到点由原生服务发送通知，点击回到对应日期/动作，下一组始终手动开始。
5. 若测试异常，点击「检查后台计时状态」，查看实际版本、服务是否运行、原生启动/到点记录，并检查系统通知和后台电池设置。

延长休息会重排通知；跳过休息、关闭计时、开始下一组或关闭提醒会取消旧通知。通知标题不含体重等个人测量数据。不依赖服务器或联网推送。

计时启动只需一次原生调用：原生侧检查通知权限、创建通知渠道、保存计时、安排闹钟、启动前台服务并返回启动回执。通知栏秒数由 Android Chronometer 显示，原生服务以单调时钟和有超时的 CPU 唤醒锁执行到点检查；不依赖 WebView 的 `setInterval`。有精确权限时同时安排 `setAlarmClock`，缺少该权限时仍能运行前台计时，但建议开启以增强锁屏/进程回收场景。服务与闹钟共享一次性令牌，避免重复通知。服务在休息结束或取消后停止。

用户反馈设备为 iQOO Neo9 Pro / Android 16 / OriginOS 6。1.0.1 的原生测试在该设备上仍未按时提醒，缺少设备日志，不能将原因直接归为厂商省电。本版增加常驻服务及本机诊断记录。通知是否显示横幅由系统设置决定；强行停止或厂商后台限制仍需实机核验。

Android 备份通过系统分享菜单导出 JSON，可保存到文件或转移到其他设备；恢复使用系统文件选择器。原网页记录不会自动出现在 Android 中，需要先导出再导入。

## 构建 Android

需要 Node.js 22+、JDK 21、Android SDK Platform 36、Build Tools 36.0.0。`JAVA_HOME` 指向 JDK，`ANDROID_HOME` 指向 SDK。

```powershell
npm.cmd install
npm.cmd run android:apk
```

也可运行 `npm.cmd run android:open` 用 Android Studio 打开。构建脚本先编译界面再同步原生资源，最终复制测试 APK 到 `releases`。测试 APK 使用本机 debug 签名；需要长期分发时应配置固定的私有 release 签名，避免换电脑后不能覆盖升级。

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

打开命令显示的本机地址。手机与电脑处于同一局域网时，可通过电脑局域网 IP 与对应端口访问；防火墙需要允许该端口。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

生产构建位于 `dist`，可交给任意静态 HTTPS 服务器。生产环境注册离线缓存。HTTPS/localhost 下支持的浏览器可安装到主屏幕；局域网 HTTP 不保证安装或屏幕常亮能力。第一次联网访问并完整加载后可离线重新打开。

## 功能

- 任意月份和跨年日历：点击日期安排训练，完成一组即显示淡绿色。
- 默认胸部示例四动作，每项 4 × 12；动作、组数、次数、重量、预计时间和休息时间都可编辑。
- 胸、肩、背、腿、休息与自定义彩色标签，多标签选择。
- 每组手动开始 → 结束记组/耗时 → 自动休息（默认 120 秒）→ 等待手动开始下一组。支持休息延长 30 秒和跳过。
- 达标后在底部绿色卡片点「完成该动作」→ 自动切到下一动作的动作间休息 → 手动「开始下一组」后计时/记录归属下一动作。最后一个动作完成后收起卡片。动作间休息默认 120 秒，可单独设置。
- 加号快捷补记一组，标明“未计时”；支持修改实际次数和重量、撤销误记。
- 按日期保存体重、修改/删除历史记录，30 天、90 天和全部记录折线。
- 模板保存与复用，只复制计划；本月训练天数、完成组数统计。
- 自动保存、JSON 备份导出/恢复，导入严格校验。
- Android 本地系统通知、可选声音/震动、准时权限状态、点击通知唤回训练、测试提醒。

## 数据与计时边界

- 数据只保存在当前设备应用的 WebView 存储中，不联网同步。网页预览与原生应用使用独立存储；网页不同设备/端口的数据也独立。
- 卸载应用、清除应用数据或清理浏览器存储会删除记录；建议定期导出备份。初始界面没有虚构的训练或体重历史。
- 计时存储绝对时间，刷新恢复；不把等待下一组时间计入训练。手动修改系统时钟会影响计时。
- Android 使用原生前台计时服务与系统闹钟；手机重启或强行停止会清除系统闹钟，重新进入应用后未过期休息会再次安排；网页预览使用 Web Notifications 与页面计时，**网页后台冻结或关闭时无法保证到点提醒**，请使用 APK 测试后台训练提醒。
- 默认示例是可编辑记录模板，不是个性化训练处方。

## 验证

`npm.cmd test` 覆盖训练状态、数据校验、通知点击路由，以及原生提醒调度的延长/跳过、异步取消竞争、失败恢复以及连续切换动作。浏览器流程见 `tests/app.spec.ts`，使用 `npx.cmd playwright test`（当前配置使用已安装的 Google Chrome）。

真实 Android 的后台切换、声音、震动和厂商电池策略仍须实机验收：设置短休息，结束一组后切到其他应用，核对提醒时间，再点击通知检查返回的动作和等待状态。

实现参考：[Capacitor Android 本地通知](https://capacitorjs.com/docs/apis/local-notifications)、[Android 准时闹钟](https://developer.android.com/develop/background-work/services/alarms)。

`npm.cmd run android:test` 使用 Robolectric Android 16（API 36）执行实际 Java 服务/接收器代码，覆盖无页面参与的到点通知、通知倒计时、取消/延长、去重、无精确权限、通知点击目标和声音/震动开关。首次运行会下载 Android 测试运行库。Windows 中文路径下通过缓存目录联接解决测试 JVM 的路径编码问题，不复制或移动项目。网络代理可通过 `powershell -ExecutionPolicy Bypass -File scripts/test-android.ps1 -ProxyUri http://127.0.0.1:8890` 传入。

官方机制：[Android 前台服务](https://developer.android.com/develop/background-work/services/fgs)、[通知 Chronometer](https://developer.android.com/reference/android/app/Notification.Builder#setChronometerCountDown(boolean))、[vivo 后台通知说明](https://kefu.vivo.com.cn/robot/imgmsgData/161d9d1d268d44ddad8410a0474bc614/index_1.html)。本次未找到可直接用于本自用 APK 的、经核实的 vivo 原子通知/原子岛接入接口，采用公开 Android API。Android 也提供 [ACTION_SET_TIMER](https://developer.android.com/reference/android/provider/AlarmClock#ACTION_SET_TIMER) 将倒计时交给时钟应用，但通用接口无法保持本项目的延长、取消和动作联动，因此未自动创建独立系统时钟计时器。
