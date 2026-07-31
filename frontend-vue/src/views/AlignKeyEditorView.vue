<script setup lang="ts">
import { ref } from "vue";

const rows = ref(Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  keyName: "",
  keyType: "",
  layer: "",
  comment: "",
})));
</script>

<template>
  <section class="page wide-page align-key-editor-page">
    <div class="page-title">
      <div>
        <p class="eyebrow">ALIGN KEY EDITOR</p>
        <h1>Align Key Table</h1>
      </div>
    </div>

    <div class="final-table-shell">
      <div class="final-table-scroll">
        <table class="final-table align-key-table">
          <thead>
            <tr class="final-table-main">
              <th>No.</th>
              <th>Key Name</th>
              <th>Key Type</th>
              <th>Layer</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <th class="number-cell">{{ row.id }}</th>
              <td><input v-model="row.keyName" :aria-label="`${row.id}행 Key Name`"></td>
              <td><input v-model="row.keyType" :aria-label="`${row.id}행 Key Type`"></td>
              <td><input v-model="row.layer" :aria-label="`${row.id}행 Layer`"></td>
              <td><input v-model="row.comment" :aria-label="`${row.id}행 Comment`"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
