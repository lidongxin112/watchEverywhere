<template>
  <a-collapse ghost class="help">
    <a-collapse-panel key="1" header="规则语法速查">
      <table class="help__table">
        <tbody>
          <tr v-for="row in rows" :key="row[0]">
            <td><code>{{ row[0] }}</code></td>
            <td>{{ row[1] }}</td>
          </tr>
        </tbody>
      </table>
    </a-collapse-panel>
  </a-collapse>
</template>

<script setup lang="ts">
const rows = [
  ['.list li@text', 'CSS 选择器（默认），@ 后为取值：text / html / innerHtml / outerHtml / 属性名'],
  ['@css:a@href', '显式指定 CSS'],
  ['$.data[*].name', 'JSONPath（以 $ 开头或 @json:）'],
  ['//div[@class="x"]/a/@href', 'XPath（以 / 开头或 @xpath:）'],
  ['@js:result.split(",")', 'JavaScript，result 为上一步结果，可用 http(url)、CryptoJS、cheerio'],
  ['@regex:(\\d+)', '正则，取第一个捕获组'],
  ['规则##正则##替换', '对结果做正则替换，省略替换内容即删除'],
  ['规则A&&规则B', '合并多个规则的结果'],
  ['规则A||规则B', '取第一个有结果的规则'],
  ['/a?id={{$.id}}', '模板拼接'],
  ['-规则', '列表规则前加 - 表示倒序'],
  ['$keyword $page $host $result', '地址变量：关键词 / 页码 / 域名 / 上一步结果'],
  ['{"url":"/s","method":"post","body":{}}', '地址也可以是 JSON 请求配置'],
  ['分组::分类::地址', '发现页地址，一行一个'],
  ['null', '地址填 null 表示不发请求，直接使用上一步结果']
];
</script>

<style scoped>
.help {
  margin-top: 8px;
}
.help__table {
  width: 100%;
  font-size: 12.5px;
  border-collapse: collapse;
}
.help__table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--we-top-bar-border);
  vertical-align: top;
}
.help__table code {
  font-family: ui-monospace, Menlo, monospace;
  white-space: nowrap;
}
</style>
