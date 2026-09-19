[English](README.md) | [中文](README.zh.md)

<!-- Synced with README.md as of 2026-09-20 -->

# Video Player Resizer

视频太小，别折腾整个页面，直接改播放器本身。

## 为什么做这个

常见的办法都打偏了。浏览器缩放连文字带侧栏一起放大，偏偏你想看的视频没大多少。全屏又把旁边对照着看的内容藏起来了。DevTools 更短命：在 `<video>` 上改个 `width`，页面不认，刷新就没。

病根很土：你看到的那个框，多半不是 `<video>` 本身。外面包着 wrapper：padding 撑高的响应式容器、钉死 `width: 100%` 的工具类、`max-width` 卡子、`aspect-ratio` 盒子。在 iframe 上设 `height` 没反应，不是你 CSS 不行，是真正管事的盒子藏在上一两层祖先里，还没人告诉你是哪个。

所以这个扩展换了思路：自动算出 sizing chain，即紧紧包住播放器的最外层祖先，加上它和媒体元素之间的一整条链，写在真正生效的地方。

## 这是什么

一个 Manifest V3 浏览器扩展（WXT 构建，MIT 开源），给任意网页视频加上类 Figma 的拖拽手柄，就地改播放器大小。只要一个权限：`storage`。没有 host 权限，没有弹窗，没有账号，没有统计。默认所有站点全关，你点开哪个，才在哪个上干活。

- 拖边或拖角，直接改播放器尺寸
- `<video>` 和嵌入的播放器 `<iframe>` 都能改，跨域的也行
- 自动识别抓错了就手动点，选一次，这个站点就记住
- 尺寸按站点记住，重置时页面分毫不差地还原

## 关键特性

- **改的是管事的盒子，不是你点的那个标签。** 多数工具只改 `<video>` 的 `width`，然后输给外层 wrapper。这里会爬到真正决定渲染尺寸的祖先，整条链一起改。padding 撑高的嵌入页、直接设 iframe 高度没反应的那种，拖得动。
- **iframe 能改，因为 overlay 从不住在里面。** `<iframe>` 里塞 DOM 根本渲染不出来，往播放器里注界面是死路。overlay 是挂在 `<html>` 上的 shadow-DOM 框，只跟踪播放器的 rect；拖拽中途立起全屏 shield，跨域 frame 抢不走你的指针事件。
- **识别错了就自己指。** 悬停高亮、点击选中的 picker，`[` / `]` 在父子之间 widen / narrow。選中结果存成元素路径（`:nth-child()` 分段、id 锚定、shadow 边界切断），按站点记住；页面 late render 用 250 到 4000ms 的阶梯重试去对；路径彻底失效就回退到自动识别，不瞎猜。
- **尺寸钉得住，页面不弄脏。** 所有写入带 `!important`，专治四种常见反制：`width: 100%` 工具类、`max-width` 卡子、`aspect-ratio` / `padding-bottom` 比例盒、裁掉溢出的祖先。被顶掉的 inline 值逐条记下来，重置时原样放回去。
- **长得像这个网站的一部分。** 框的颜色从页面借（`theme-color` → 品牌自定义属性 → 链接色），在 OKLCH 里归一化：色相不动，亮度拉到黑底白字都 legible 的带子里，灰了吧唧的品牌色先把 chroma 托起来。页面给不出颜色时回退到内置 accent，SPA 切路由会重新取色。

## 有它 / 没它

| | 没它 | 有它 |
|---|---|---|
| 教程视频太小 | 缩放整个页面，或者全屏 | 拖一下角，旁边的文章不动 |
| 嵌入播放器 | DevTools 改 iframe，纹丝不动 | sizing chain 找到真正管事的 wrapper |
| 一页三个视频抓错了 | 来回悬停碰运气 | Target 列表 + 手动点，钉死在这个站点 |
| 下次再来 | 重新拖一遍 | 按站点的尺寸自动恢复 |
| 重置之后 | 残留 inline 样式 | 被顶掉的值精确还原 |
| 隐私代价 | 账号、同步服务器、统计 | 只要 `storage`，全在本地 |

## 怎么实现的

三件事，撑起「改视频尺寸」。

### 找到真正管事的盒子

你看到的框多半是 wrapper，不是媒体标签。按面积、可见占比、是否在播打分（嵌入域名优先于广告），爬到决定渲染尺寸的祖先，整条链一起改。late layout 落定后再记自然尺寸；悬停换目标，手动钉死就不再抢。

### 写在页面无视不了的地方

真实页面有四种反制：钉死的宽度、`max-width` 卡子、比例盒、裁溢出的祖先。写入走最高优先级，逐一破掉，被顶掉的值记下来，重置时原样放回。拖拽、`Shift` / `Alt`、`Esc`、双击、键盘微调，走的都是同一条写入路径。

### 别挡页面的路

overlay 浮在播放器外面，跨域 iframe 照常工作，页面脚本也绊不到它。识别是启发式，点选是标配后路：选一次按站点记住，对不上就回退到自动。默认全关，哪个站点你说了算；设置漫游，量出来的尺寸留本地。

### 设计取舍

| 选择 | 原因 |
|---|---|
| overlay 放在外面，不塞进播放器 | iframe 里注的 DOM 不渲染，从外面跟踪是唯一处处成立的形状 |
| 高优先级写 + 被顶掉的值记日志 | 普通 inline 会被工具类吃掉；记日志重置才能精确 |
| 默认全关，按站点开 | 视频站、通话、feed 脾气各异，blocklist 列不完，默认关 cover 得住 |
| 无弹窗，控件放在页里 | 图标只管 toggle，不吃点击 |
| 隻要 `storage` 权限，不统计 | 识别全在本地跑 |

## 快速开始

**用（4 步）：**

1. 装上 unpacked 构建（`bun run dev`）或商店 ZIP，打开任意有视频的页面。
2. 点工具栏图标 → **Enable here**。这个 host 从此悬停就出框。
3. 拖手柄。`Shift` 反转 aspect lock，`Alt` 关 snapping，双击重置。
4. 抓错框？**More** → **Select element**，点对的那个。**Use automatic** 交回去。

**开发（5 步）：**

```bash
bun install
bun run dev        # fresh profile 里起 unpacked 构建
bun run test       # 8 个套件：detector、sizing、overlay、picker、toolbar、theme、storage、paths
bun run compile    # tsc --noEmit
bun run build
bun run verify:release  # tests + compile + build + 商店包检查
```

手动 case 在 `examples/` 下：起个本地 HTTP 服务，打开对应站点，拖。`bun run package:chrome` 把可上传 ZIP 写到 `.output/`。

丑话说前面：每帧重写布局的站点钉不住；同源子 frame 里的 pick 下次打不开（当次会话照常用）。识别本来就是启发式，picker 是诚实后路，不是失败。

## License

MIT，见 [LICENSE](LICENSE)。隐私细节：[PRIVACY.md](PRIVACY.md).
