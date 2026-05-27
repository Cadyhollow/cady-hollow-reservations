path = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/electric-bill-email/route.ts'

with open(path, 'r') as f:
    content = f.read()

# Calculate previous balance = totalBalance - electricAmount - new other charges
old_itemized = """    const itemizedRows = otherCharges.map((item: any) => `
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${item.description}${item.charged_at ? ' · ' + new Date(item.charged_at).toLocaleDateString() : ''}</td>
        <td style="padding:6px 0;color:#ffffff;font-size:14px;text-align:right;">$${(item.line_total/100).toFixed(2)}</td>
      </tr>`).join('')"""

new_itemized = """    const itemizedRows = otherCharges.map((item: any) => `
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${item.description}${item.charged_at ? ' · ' + new Date(item.charged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
        <td style="padding:6px 0;color:#ffffff;font-size:14px;text-align:right;">$${(item.line_total/100).toFixed(2)}</td>
      </tr>`).join('')

    // Previous balance = total due minus this month's new charges
    const newChargesTotal = electricAmount + otherCharges.reduce((s: number, i: any) => s + i.line_total, 0)
    const previousBalance = totalBalance - newChargesTotal
    const hasPreviousBalance = previousBalance > 0"""

old_table = """    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${billingMonth} Electric</td>
        <td style="padding:6px 0;color:#FCD34D;font-size:14px;font-weight:bold;text-align:right;">$${(electricAmount/100).toFixed(2)}</td>
      </tr>
      ${itemizedRows}
      ${otherCharges.length > 0 ? '<tr><td colspan="2" style="padding:8px 0 0;border-top:1px solid #374151;"></td></tr>' : ''}
      <tr>
        <td style="padding:8px 0 4px;color:#ffffff;font-size:16px;font-weight:bold;">Total Balance Due</td>
        <td style="padding:8px 0 4px;color:${totalBalance === 0 ? '#4ADE80' : '#FCD34D'};font-size:16px;font-weight:bold;text-align:right;">
          ${totalBalance === 0 ? '✓ Paid in full' : '$' + (totalBalance/100).toFixed(2)}
        </td>
      </tr>
    </table>"""

new_table = """    <table style="width:100%;border-collapse:collapse;">
      ${hasPreviousBalance ? `
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">Previous balance</td>
        <td style="padding:6px 0;color:#FCA5A5;font-size:14px;font-weight:bold;text-align:right;">$${(previousBalance/100).toFixed(2)}</td>
      </tr>
      <tr><td colspan="2" style="padding:4px 0;border-top:1px solid #374151;"></td></tr>
      ` : ''}
      <tr>
        <td style="padding:6px 0;color:#9CA3AF;font-size:14px;">${billingMonth} Electric</td>
        <td style="padding:6px 0;color:#FCD34D;font-size:14px;font-weight:bold;text-align:right;">$${(electricAmount/100).toFixed(2)}</td>
      </tr>
      ${itemizedRows}
      <tr><td colspan="2" style="padding:8px 0 0;border-top:1px solid #374151;"></td></tr>
      <tr>
        <td style="padding:8px 0 4px;color:#ffffff;font-size:16px;font-weight:bold;">Total Balance Due</td>
        <td style="padding:8px 0 4px;color:${totalBalance === 0 ? '#4ADE80' : '#FCD34D'};font-size:16px;font-weight:bold;text-align:right;">
          ${totalBalance === 0 ? '✓ Paid in full' : '$' + (totalBalance/100).toFixed(2)}
        </td>
      </tr>
    </table>"""

checks = [
    ('Previous balance calculation', old_itemized, new_itemized),
    ('Previous balance in email table', old_table, new_table),
]

all_good = True
for label, old, new in checks:
    if old in content:
        content = content.replace(old, new, 1)
        print(f'  \u2713 {label}')
    else:
        print(f'  \u2717 MISSING: {label}')
        all_good = False

if all_good:
    with open(path, 'w') as f:
        f.write(content)
    print('\n\u2705 Fix applied and file saved!')
    print('Next: cd ~/cady-hollow-reservations && git add . && git commit -m "Electric billing: add previous balance line item to email" && git push')
else:
    print('\n\u274c Some edits did not apply \u2014 file NOT saved. Paste output above to Claude.')
