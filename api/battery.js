/**
 * Пока не подключено. Когда будешь готов — принеси сюда Client ID/Secret
 * и refresh token Tesla Fleet API из TeslaDash, я допишу настоящий запрос
 * к vehicle_data (регион EU: https://fleet-api.prd.eu.vn.cloud.tesla.com).
 */
module.exports = async (req, res) => {
  res.status(501).json({ error: 'Tesla Fleet API ещё не подключена' });
};
