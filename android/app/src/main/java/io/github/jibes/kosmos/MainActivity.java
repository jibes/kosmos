package io.github.jibes.kosmos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KosmosPlugin.class);
        registerPlugin(NavLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
