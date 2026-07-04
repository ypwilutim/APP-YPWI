// Employment Rules Functions for admin-dashboard.html

async function loadEmploymentRules() {
  try {
    const response = await fetch('/api/employment-rules', {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    const result = await response.json();
    if (result.success) {
      const tbody = document.getElementById('employment-rules-body');
      tbody.innerHTML = result.rules.map(r => `
        <tr class="border-b">
          <td class="px-3 py-2">${r.job_title_pattern}</td>
          <td class="px-3 py-2">${r.employment_type}</td>
          <td class="px-3 py-2">${r.min_years}</td>
          <td class="px-3 py-2">${r.max_years}</td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading employment rules:', error);
  }
}

window.loadEmploymentRules = loadEmploymentRules;