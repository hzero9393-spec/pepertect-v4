'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Medal,
  Crown,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Users,
  Trophy,
} from 'lucide-react'
import { formatNumber } from '@/lib/format'

const top3 = [
  { rank: 2, name: 'Priya Sharma', initials: 'PS', roi: 287.4, winRate: 82.1, borderColor: '#C0C0C0', bgColor: 'bg-gray-800', textColor: 'text-gray-300', borderClass: 'border-gray-500' },
  { rank: 1, name: 'Rahul Gupta', initials: 'RG', roi: 342.8, winRate: 89.3, borderColor: '#FFD700', bgColor: 'bg-yellow-900/30', textColor: 'text-yellow-400', borderClass: 'border-yellow-500' },
  { rank: 3, name: 'Amit Patel', initials: 'AP', roi: 256.1, winRate: 76.5, borderColor: '#CD7F32', bgColor: 'bg-amber-900/30', textColor: 'text-amber-400', borderClass: 'border-amber-500' },
]

const leaderboardData = [
  { rank: 4, name: 'Emily Zhang', initials: 'EZ', roi: 198.6, winRate: 74.2, totalTrades: 2156, pnl: '+₹1.24L', trend: 'up' },
  { rank: 5, name: 'David Kim', initials: 'DK', roi: 187.2, winRate: 71.8, totalTrades: 1890, pnl: '+₹98.7K', trend: 'up' },
  { rank: 6, name: 'Lisa Anderson', initials: 'LA', roi: 165.4, winRate: 69.5, totalTrades: 2340, pnl: '+₹87.2K', trend: 'down' },
  { rank: 7, name: 'James Miller', initials: 'JM', roi: 152.8, winRate: 67.9, totalTrades: 1567, pnl: '+₹76.5K', trend: 'up' },
  { rank: 8, name: 'Priya Sharma', initials: 'PS', roi: 141.3, winRate: 66.2, totalTrades: 1923, pnl: '+₹65.8K', trend: 'down' },
  { rank: 9, name: 'Michael Brown', initials: 'MB', roi: 128.7, winRate: 64.8, totalTrades: 2890, pnl: '+₹54.3K', trend: 'up' },
  { rank: 10, name: 'Anna Schmidt', initials: 'AS', roi: 115.2, winRate: 62.1, totalTrades: 1678, pnl: '+₹43.1K', trend: 'down' },
  { rank: 11, name: 'Carlos Rivera', initials: 'CR', roi: 102.8, winRate: 60.4, totalTrades: 2145, pnl: '+₹38.9K', trend: 'up' },
  { rank: 12, name: 'Yuki Tanaka', initials: 'YT', roi: 95.4, winRate: 58.7, totalTrades: 1345, pnl: '+₹29.4K', trend: 'down' },
  { rank: 13, name: 'Olga Petrova', initials: 'OP', roi: 88.1, winRate: 56.3, totalTrades: 2567, pnl: '+₹22.7K', trend: 'up' },
]

const yourRow = {
  rank: 42,
  name: 'Alex Thompson',
  initials: 'AT',
  roi: 68.4,
  winRate: 68.4,
  totalTrades: 1284,
  pnl: '+₹42.5K',
  trend: 'up',
}

const timeFilters = ['Weekly', 'Monthly', 'All Time'] as const
const categoryFilters = ['Overall', 'Equity', 'F&O', 'Index'] as const

function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <ArrowUpRight className="size-4 text-emerald-400" />
  if (trend === 'down') return <ArrowDownRight className="size-4 text-red-400" />
  return <Minus className="size-4 text-gray-400" />
}

export function LeaderboardPage() {
  const [timeFilter, setTimeFilter] = useState<string>('Monthly')
  const [categoryFilter, setCategoryFilter] = useState<string>('Overall')

  return (
    <div className="min-h-screen bg-[#0a0e17] p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight flex items-center gap-2">
              <Trophy className="size-7 text-amber-500" />
              Leaderboard
            </h1>
            <p className="text-gray-400 mt-1 text-sm">See how you stack up against the best traders</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="bg-[#111827] border border-[#1f2937] inline-flex items-center gap-1 rounded-full p-1 self-start">
            {timeFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`tab-transition rounded-full px-4 py-1.5 text-xs font-semibold ${
                  timeFilter === filter
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-gray-400 hover:bg-[#1a2332]'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="bg-[#111827] border border-[#1f2937] inline-flex items-center gap-1 rounded-full p-1 self-start">
            {categoryFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setCategoryFilter(filter)}
                className={`tab-transition rounded-full px-4 py-1.5 text-xs font-semibold ${
                  categoryFilter === filter
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-gray-400 hover:bg-[#1a2332]'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
        {top3.map((player) => {
          const isFirst = player.rank === 1
          return (
            <Card
              key={player.rank}
              className={`bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1 border-2 ${player.borderClass} ${isFirst ? 'sm:scale-105 sm:z-10' : ''}`}
            >
              <CardContent className={`p-5 sm:p-6 text-center ${isFirst ? 'sm:py-8' : ''}`}>
                {isFirst && (
                  <div className="flex justify-center mb-2">
                    <Crown className="size-8 text-yellow-500 fill-yellow-400" />
                  </div>
                )}

                <div className="flex justify-center mb-3">
                  <div
                    className={`size-12 ${isFirst ? 'size-14' : ''} rounded-full flex items-center justify-center font-bold text-lg ${player.bgColor} ${player.textColor} border-2`}
                    style={{ borderColor: player.borderColor }}
                  >
                    {player.rank}
                  </div>
                </div>

                <div className="flex justify-center mb-3">
                  <div
                    className={`size-16 ${isFirst ? 'size-20' : ''} rounded-full flex items-center justify-center font-bold text-xl ${player.bgColor} ${player.textColor}`}
                    style={{ border: `3px solid ${player.borderColor}` }}
                  >
                    {player.initials}
                  </div>
                </div>

                <h3 className={`font-bold text-white ${isFirst ? 'text-lg' : 'text-base'}`}>{player.name}</h3>

                <p className={`font-mono font-bold mt-1 ${isFirst ? 'text-2xl text-amber-500' : 'text-xl text-white'}`}>
                  +{player.roi}% ROI
                </p>

                <Badge variant="secondary" className="mt-2 bg-emerald-500/10 text-emerald-400 border-0 text-xs font-semibold">
                  <TrendingUp className="size-3 mr-1" />
                  {player.winRate}% Win Rate
                </Badge>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Full Rankings Table */}
      <Card className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
              <Medal className="size-5 text-amber-500" />
              Full Rankings
            </CardTitle>
            <Badge variant="secondary" className="bg-[#1f2937] text-gray-400 border-0 text-xs gap-1">
              <Users className="size-3" />
              2,847 traders
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-[#1f2937]">
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider w-16">Rank</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider">User</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider text-right">ROI%</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider text-right">Win Rate</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider text-right hidden sm:table-cell">Total Trades</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider text-right hidden md:table-cell">P&amp;L</TableHead>
                  <TableHead className="text-gray-400 font-semibold text-xs uppercase tracking-wider text-right w-16">Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* "You" highlighted row */}
                <TableRow className="bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10">
                  <TableCell className="font-bold text-amber-500">#{yourRow.rank}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-full bg-amber-500/10 flex items-center justify-center text-xs font-bold text-amber-500 border border-amber-500/30">
                        {yourRow.initials}
                      </div>
                      <div>
                        <span className="font-semibold text-amber-500 text-sm">{yourRow.name}</span>
                        <Badge variant="secondary" className="ml-2 bg-amber-500/10 text-amber-500 border-0 text-[10px] font-bold px-1.5 py-0">You</Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-emerald-400">+{yourRow.roi}%</TableCell>
                  <TableCell className="text-right font-mono text-white">{yourRow.winRate}%</TableCell>
                  <TableCell className="text-right font-mono text-white hidden sm:table-cell">{formatNumber(yourRow.totalTrades)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-emerald-400 hidden md:table-cell">{yourRow.pnl}</TableCell>
                  <TableCell className="text-right"><TrendIcon trend={yourRow.trend} /></TableCell>
                </TableRow>

                {/* Other rows */}
                {leaderboardData.map((row) => (
                  <TableRow key={row.rank} className="border-[#1f2937] hover:bg-[#1a2332]/50">
                    <TableCell className="font-semibold text-gray-400">#{row.rank}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="size-8 rounded-full bg-[#1f2937] flex items-center justify-center text-xs font-bold text-gray-400">
                          {row.initials}
                        </div>
                        <span className="font-medium text-white text-sm">{row.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-emerald-400">+{row.roi}%</TableCell>
                    <TableCell className="text-right font-mono text-white">{row.winRate}%</TableCell>
                    <TableCell className="text-right font-mono text-white hidden sm:table-cell">{formatNumber(row.totalTrades)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold text-emerald-400 hidden md:table-cell">{row.pnl}</TableCell>
                    <TableCell className="text-right"><TrendIcon trend={row.trend} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Your Stats Card */}
      <Card className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm border-l-4 border-l-amber-500">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Trophy className="size-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm">Your Ranking</h3>
                <p className="text-gray-400 text-xs">Updated in real-time</p>
              </div>
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="text-center">
                <p className="font-mono text-xl font-bold text-amber-500">#42</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Rank</p>
              </div>
              <div className="size-8 w-px bg-[#1f2937]" />
              <div className="text-center">
                <p className="font-mono text-xl font-bold text-emerald-400">Top 5%</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Percentile</p>
              </div>
              <div className="size-8 w-px bg-[#1f2937]" />
              <div className="text-center">
                <div className="flex items-center justify-center gap-1">
                  <ArrowUpRight className="size-4 text-emerald-400" />
                  <p className="font-mono text-xl font-bold text-emerald-400">+2</p>
                </div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">This Week</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
