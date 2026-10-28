Treellis local workspace

启动
1. 在 VS Code 中打开此文件夹。
2. 首次安装：npm install
3. 一个终端运行后端：npm run server
4. 另一个终端运行前端：npm run dev
5. 打开前端终端显示的本地网址。

保存场景
点击 Save As 后可输入文件名，再确认下载当前场景；省略后缀时自动补上 .json。支持 Enter 确认和 Esc 取消。
启动时读取的本地默认场景位于 public/scene.json。
2026-10-21 导入的新生成结果已保存为默认场景，并在 jsonStore/scene_2026-10-21T11-52-55-906Z.json 保留原始副本。
本次保存另有 public/commits/scene_2026-10-21T11-55-21-355Z.json 快照。

API Key
用户可以在 Key 设置中填写自己的 OpenAI API Key。
不点击 Save Key 时，Key 仅用于当前界面；点击 Save Key 后，Key 保存在当前浏览器的 localStorage。
全局生成和节点生成共用同一个本地保存位置。
此发布副本不包含 API Key 或私人配置；请在界面填写自己的 Key，或在本机环境中配置 OPENAI_API_KEY。
.local 已加入 Git 忽略和 Vite 文件访问拒绝规则；Key 本体与路径配置均不会进入 dist。

模型与档位
全局创建、全局编辑和节点编辑均使用 GPT-6.1 Sol（gpt-6.1-sol）。
可选推理强度：Low / Medium / High / XHigh / Max，默认 Medium。
选择项与 API reasoning.effort 的 low / medium / high / xhigh / max 一一对应。
所填写的 Key 需具备该模型的 API 访问权限。
官方说明：https://developers.openai.com/api/docs/models/gpt-6.1-sol

此次更新
采用提供的 UI 原型调整顶栏和输入框；拖动 Viewport 与输入区交界线调整高度。
全局创建、全局编辑和节点编辑共用后端生成服务；需要同时运行 npm run server 与 npm run dev。
流程：编辑范围与空间上下文 -> 结构化生成 -> AML 校验 -> 真实几何与客观约束检查 -> 必要时最多修复两次 -> 一次性应用结果。
局部参数修改优先使用 patch，节点修改限定在选中子树。失败或取消保留场景和提示词，生成结果支持撤销与重做。
结构树、参数面板和 3D renderer 的界面与建模功能保留。
补齐原 server.js 已使用的 express、cors 启动依赖。
自动验证：npm test；生产构建：npm run build。
框架设计、限制与验收说明：GENERATION-FRAMEWORK.txt。

实时进度与分步细化
生成时显示当前阶段、部件步骤、已完成部件及累计用时 MM:SS；可用时显示 OpenAI 返回的公开推理摘要。
模型生成没有总时长或响应读取空闲时长上限；Stop 可随时取消等待。累计用时包括生成与检查，续跑时继续累计，停止等待期间不计入。
XHigh / Max 默认 Step by step，可在生成方式中手动选择 Single pass。其他档位沿用单次生成。
分步模式先规划最多六个不重叠子树，按顺序生成、检查并更新；新建场景先生成粗略骨架。
每个已应用步骤都可撤销。Stop 或后续失败保留已完成部分；在当前页面点击 Continue remaining 继续剩余步骤。
改变场景、选择、提示词或档位后，旧计划失效；刷新页面会丢失页面内的草稿和续跑状态，需先 Save As 保存场景。
输出上限（含推理和最终结果）：Low 16000 / Medium 32000 / High 64000 / XHigh 96000 / Max 128000 tokens。
实现方案与说明：STAGED-GENERATION.txt。

节点问答与一键采纳
节点提示可以先解释部件或询问修改意图，回复下方最多显示三个可执行选项。每项显示目标节点名称和路径，点击后自动在该范围执行；父节点建议会同步切换结构树和Viewport的选中范围。
点击 Custom answer 可输入自己的回答，再点 Continue 接着上一轮对话处理。当前弹窗保留最近六条用户/助手消息，不把公开进度摘要作为用户回答。
结果仍经过AML和几何检查，并支持Undo。场景或选区变化后旧建议失效，点击 Start new question 按最新场景重新提问。网络失败保留对话和输入，可直接重试。
基线快照附带自动化测试；运行 npm test 和 npm run build 验证本机环境。

版本来源
此目录是 baseline-v1 的 GitHub 发布副本。功能源码和提示模板逐字节保留。发布包移除本机 API 配置、用户行为记录及独立研究资料；这些资料已保留在本地冻结备份。详见 SNAPSHOT-PROVENANCE.json。
