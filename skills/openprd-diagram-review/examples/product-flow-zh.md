用户请求：
把新用户首次完成一个教学任务的流程图画出来，包含失败路径和需要确认的节点。

期望行为：
- 选择 product-flow 视图
- 如果当前 CLI 只有 architecture renderer，也不要假装有 flow renderer
- 先生成 flow contract，再引导用户确认步骤、分支和异常路径
