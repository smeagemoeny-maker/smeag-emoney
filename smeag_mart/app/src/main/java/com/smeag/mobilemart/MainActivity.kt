package com.smeag.mobilemart

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.smeag.mobilemart.data.SessionManager
import com.smeag.mobilemart.nfc.NfcHelper
import com.smeag.mobilemart.ui.screens.*
import com.smeag.mobilemart.ui.theme.SmeagMobileMartTheme

/** Simple event wrapper so LaunchedEffect can react to a fresh NFC tap even if the same card is tapped twice in a row. */
data class NfcEvent(val uid: String, val ts: Long)

sealed class Screen(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    data object Register : Screen("register", "Register", Icons.Filled.AddBox)
    data object Modify : Screen("modify", "Modify", Icons.Filled.Edit)
    data object Sales : Screen("sales", "Sales", Icons.Filled.ShoppingCart)
    data object History : Screen("history", "History", Icons.Filled.Receipt)
    data object Report : Screen("report", "Report", Icons.Filled.BarChart)
    data object Buyer : Screen("buyer", "Buyer Info", Icons.Filled.Badge)
    data object PusanPay : Screen("pusanpay", "Pusan Pay", Icons.Filled.Payments)
    data object PayList : Screen("paylist", "Pay List", Icons.Filled.ListAlt)
}

val tabScreens = listOf(Screen.Register, Screen.Modify, Screen.Sales, Screen.History, Screen.Report, Screen.Buyer, Screen.PusanPay, Screen.PayList)

class MainActivity : ComponentActivity() {

    private lateinit var nfcHelper: NfcHelper
    private val nfcEvent = mutableStateOf<NfcEvent?>(null)
    private val viewModel: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nfcHelper = NfcHelper(this)

        setContent {
            SmeagMobileMartTheme {
                SmeagApp(viewModel = viewModel, nfcEvent = nfcEvent)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        nfcHelper.enableForegroundDispatch()
    }

    override fun onPause() {
        super.onPause()
        nfcHelper.disableForegroundDispatch()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val uid = nfcHelper.handleIntent(intent)
        if (uid != null) nfcEvent.value = NfcEvent(uid, System.currentTimeMillis())
    }
}

@Composable
fun SmeagApp(viewModel: AppViewModel, nfcEvent: State<NfcEvent?>) {
    val manager by SessionManager.currentManager
    val navController = rememberNavController()

    if (manager == null) {
        LoginScreen(onLoginSuccess = { })
        return
    }

    Scaffold(
        bottomBar = {
            val backStackEntry by navController.currentBackStackEntryAsState()
            val currentRoute = backStackEntry?.destination?.hierarchy?.firstOrNull()?.route
            NavigationBar {
                tabScreens.forEach { screen ->
                    NavigationBarItem(
                        selected = currentRoute == screen.route,
                        onClick = {
                            navController.navigate(screen.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(screen.icon, contentDescription = screen.label) },
                        label = { Text(screen.label, maxLines = 1) },
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.padding(padding)) {
            NavHost(navController = navController, startDestination = Screen.Sales.route) {
                composable(Screen.Register.route) { RegisterScreen(viewModel) }
                composable(Screen.Modify.route) { ModifyScreen(viewModel) }
                composable(Screen.Sales.route) {
                    SalesScreen(
                        viewModel = viewModel,
                        nfcEvent = nfcEvent,
                        onCheckoutComplete = { navController.navigate("receipt") },
                    )
                }
                composable("receipt") { ReceiptScreen(viewModel, onDone = { navController.popBackStack() }) }
                composable(Screen.History.route) { HistoryScreen(viewModel) }
                composable(Screen.Report.route) { ReportScreen(viewModel) }
                composable(Screen.Buyer.route) { BuyerScreen(viewModel, nfcEvent = nfcEvent) }
                composable(Screen.PusanPay.route) { PusanmartPaymentScreen(viewModel, nfcEvent = nfcEvent) }
                composable(Screen.PayList.route) { PayListScreen(viewModel) }
            }
        }
    }
}
