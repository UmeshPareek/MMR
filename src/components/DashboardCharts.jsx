import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts'
import { formatCurrency } from '@/utils/helpers'

export default function DashboardCharts({ trend, expenseBreakdown }) {
  return (
    <div className="card p-5 lg:col-span-2">
      <h3 className="font-semibold text-surface-800 mb-4">Revenue vs Expenses</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={trend} barSize={20}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
          <XAxis dataKey="month" tick={{fontSize:11, fill:'#94a3b8'}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fontSize:11, fill:'#94a3b8'}} tickFormatter={v=>`₹${(v/100000).toFixed(0)}L`} axisLine={false} tickLine={false}/>
          <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:8,border:'1px solid #e2e8f0',boxShadow:'0 4px 12px rgba(0,0,0,.08)'}}/>
          <Legend wrapperStyle={{fontSize:12}}/>
          <Bar dataKey="revenue" name="Revenue" fill="#0D9488" radius={[4,4,0,0]}/>
          <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>

      {expenseBreakdown.length > 0 && (
        <div className="mt-4 pt-4 border-t border-surface-100 grid grid-cols-2 gap-4 items-center">
          <div>
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Expense Breakdown</p>
            <div className="space-y-2">
              {expenseBreakdown.map(e => (
                <div key={e.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{background:e.color}}/>
                    <span className="text-surface-600">{e.name}</span>
                  </div>
                  <span className="font-mono font-semibold text-surface-700">{formatCurrency(e.value)}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <PieChart>
              <Pie data={expenseBreakdown} cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={3}>
                {expenseBreakdown.map((e,i) => <Cell key={i} fill={e.color}/>)}
              </Pie>
              <Tooltip formatter={v=>formatCurrency(v)} contentStyle={{borderRadius:8,fontSize:11}}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
